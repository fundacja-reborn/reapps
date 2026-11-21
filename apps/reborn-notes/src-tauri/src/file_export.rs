//! "Save as..." for exports: the desktop counterpart of the mobile share
//! sheet (`native-file-export.ts`).
//!
//! WKWebView ignores `<a download>` on blob: URLs, so the page cannot save a
//! file by itself. It hands the bytes to this command instead, and the user
//! picks the destination in the system save dialog. The page only suggests a
//! file name - it never supplies a path - so page code cannot write anywhere
//! the user did not choose in that dialog.

use std::path::Path;

use base64::Engine;
use serde::Serialize;
use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

use crate::folder_fs::write_atomic;

/// File name offered when the page's suggestion is unusable.
const FALLBACK_NAME: &str = "export";

#[derive(Serialize)]
pub struct SaveResult {
    /// `false` when the user dismissed the dialog.
    saved: bool,
}

/// Reduce a suggested file name to a single, harmless path component.
fn suggested_name(name: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !c.is_control()).collect();
    let leaf = cleaned
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim();
    if leaf.is_empty() || leaf == "." || leaf == ".." {
        FALLBACK_NAME.to_owned()
    } else {
        leaf.to_owned()
    }
}

/// Decode the page's base64 payload and write it to `target`.
fn save_bytes(target: &Path, data: &str) -> Result<(), &'static str> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "file export: invalid data")?;
    write_atomic(target, &bytes, false).map_err(|_| "file export: write failed")
}

/// Ask where to save an export and write it there.
#[tauri::command(async)]
pub fn file_export_save(
    window: WebviewWindow,
    name: String,
    data: String,
) -> Result<SaveResult, &'static str> {
    let Some(picked) = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(suggested_name(&name))
        .blocking_save_file()
    else {
        return Ok(SaveResult { saved: false });
    };
    let target = picked
        .into_path()
        .map_err(|_| "file export: invalid destination")?;
    save_bytes(&target, &data)?;
    Ok(SaveResult { saved: true })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn keeps_an_ordinary_file_name() {
        assert_eq!(
            suggested_name("Meeting notes - June 20.md"),
            "Meeting notes - June 20.md"
        );
        assert_eq!(suggested_name("notatki zażółć.pdf"), "notatki zażółć.pdf");
    }

    #[test]
    fn strips_directories_and_control_characters() {
        assert_eq!(suggested_name("../../etc/passwd"), "passwd");
        assert_eq!(suggested_name("C:\\Users\\x\\evil.md"), "evil.md");
        assert_eq!(suggested_name("/absolute/path/note.md"), "note.md");
        assert_eq!(suggested_name("line\nbreak\u{0}.md"), "linebreak.md");
    }

    #[test]
    fn falls_back_when_nothing_usable_is_left() {
        for name in ["", "   ", "..", ".", "dir/", "a/.."] {
            assert_eq!(suggested_name(name), FALLBACK_NAME, "{name:?}");
        }
    }

    #[test]
    fn writes_the_decoded_bytes() {
        let dir = std::env::temp_dir().join(format!("file-export-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("export.bin");

        // base64 of the bytes 00 ff 10 "ok"
        save_bytes(&target, "AP8Qb2s=").unwrap();

        assert_eq!(fs::read(&target).unwrap(), [0x00, 0xff, 0x10, b'o', b'k']);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_payload_that_is_not_base64() {
        let target = std::env::temp_dir().join("file-export-never-written.bin");

        assert_eq!(
            save_bytes(&target, "not base64 !!"),
            Err("file export: invalid data")
        );
        assert!(!target.exists());
    }
}
