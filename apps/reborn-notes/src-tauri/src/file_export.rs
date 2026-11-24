//! "Save as..." for exports: the desktop counterpart of the mobile share
//! sheet (`native-file-export.ts`).
//!
//! WKWebView ignores `<a download>` on blob: URLs, so the page cannot save a
//! file by itself. It hands the bytes to this command instead, and the user
//! picks the destination in the system save dialog. The page only suggests a
//! file name - it never supplies a path - so page code cannot write anywhere
//! the user did not choose in that dialog.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

use base64::Engine;
use serde::Serialize;
use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

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

/// Write the export straight into the file the user picked.
///
/// Not the temporary-file-and-rename write `folder_fs` uses for backups: in
/// the App Sandbox the save dialog grants access to the chosen file only, not
/// to its folder, so a temporary file next to it is refused and every export
/// failed (smoke test 2026-11-24). A write that fails after the file was
/// opened removes it, so no half-written export is left behind; a file that
/// could not even be opened is left as it was.
fn write_export(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(target)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    if written.is_err() {
        drop(file);
        let _ = fs::remove_file(target);
    }
    written
}

/// Decode the page's base64 payload and write it to `target`.
fn save_bytes(target: &Path, data: &str) -> Result<(), &'static str> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "file export: invalid data")?;
    write_export(target, &bytes).map_err(|_| "file export: write failed")
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
    fn replaces_the_picked_file_without_touching_its_folder() {
        let dir = std::env::temp_dir().join(format!("file-export-replace-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("note.md");
        fs::write(&target, "an older, longer export").unwrap();

        // base64 of "new"
        save_bytes(&target, "bmV3").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        // Nothing but the picked file: the sandbox grants no other name here.
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["note.md"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_destination_that_cannot_be_opened_is_left_alone() {
        let dir =
            std::env::temp_dir().join(format!("file-export-unopenable-{}", std::process::id()));
        // A directory where the file should be: opening it for writing fails.
        let target = dir.join("export.md");
        fs::create_dir_all(&target).unwrap();

        assert_eq!(
            save_bytes(&target, "bmV3"),
            Err("file export: write failed")
        );
        assert!(target.is_dir());
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
