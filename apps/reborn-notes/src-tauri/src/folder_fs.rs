//! Persistent access to user-picked folders: the desktop counterpart of the
//! app-local FolderFs Capacitor plugin (`ios/App/App/FolderFsPlugin.swift`).
//!
//! Two features sit on top of it: the one-way folder sync (disk -> app, read
//! only) and the automated encrypted backup (writes and rotates files in one
//! folder). Both only ever see ciphertext-free Markdown the user already keeps
//! on disk, or backup envelopes that are encrypted before they reach this
//! module; nothing here talks to the network.
//!
//! # Trust model
//!
//! On iOS the "bookmark" handed to the webview is an OS capability: page code
//! cannot forge one for a folder the user never picked. A desktop path is just
//! a string, so the same guarantee is rebuilt here:
//!
//! - the webview never names a folder by path. `folder_fs_pick_directory` shows
//!   the system dialog and answers with a random token; the token -> folder
//!   mapping (a *grant*) lives on the Rust side only (`folder-grants.json` in
//!   the app data directory);
//! - every other command takes a token plus a path relative to that folder,
//!   rejects absolute paths and dot segments, and refuses anything that
//!   resolves outside the folder (symlinks included);
//! - writes and deletes need a grant picked with `write: true`, so a folder
//!   linked for sync stays read only.
//!
//! A compromised page can therefore reach exactly the folders the user linked,
//! with the access they were linked for - the same bound as on mobile.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// File in the app data directory that persists the grants across launches.
const GRANTS_FILE: &str = "folder-grants.json";

/// Deepest directory level a listing descends to. A linked vault is a handful
/// of levels deep; the cap only bounds a pathological tree.
const MAX_DEPTH: usize = 32;

/// Error handed to the webview. Messages are fixed strings on purpose: no
/// path, file name or file content ever travels in an error.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct FolderFsError {
    code: &'static str,
    message: &'static str,
}

const ACCESS_DENIED: FolderFsError = FolderFsError {
    code: "ACCESS_DENIED",
    message: "No access to this folder",
};
const FOLDER_NOT_FOUND: FolderFsError = FolderFsError {
    code: "FOLDER_NOT_FOUND",
    message: "The linked folder no longer exists",
};
const FILE_NOT_FOUND: FolderFsError = FolderFsError {
    code: "FILE_NOT_FOUND",
    message: "The file no longer exists",
};
const INVALID_PATH: FolderFsError = FolderFsError {
    code: "INVALID_PATH",
    message: "The path leaves the linked folder",
};
const READ_FAILED: FolderFsError = FolderFsError {
    code: "READ_FAILED",
    message: "Failed to read from the folder",
};
const WRITE_FAILED: FolderFsError = FolderFsError {
    code: "WRITE_FAILED",
    message: "Failed to write to the folder",
};
const DELETE_FAILED: FolderFsError = FolderFsError {
    code: "DELETE_FAILED",
    message: "Failed to delete from the folder",
};
const PICK_FAILED: FolderFsError = FolderFsError {
    code: "PICK_FAILED",
    message: "Failed to link the folder",
};
const STORE_FAILED: FolderFsError = FolderFsError {
    code: "STORE_FAILED",
    message: "Failed to save the folder link",
};

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

/// One linked folder: where it is and whether it may be written to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Grant {
    path: PathBuf,
    write: bool,
}

/// On-disk shape of the grants file.
#[derive(Default, Serialize, Deserialize)]
struct GrantsDocument {
    grants: HashMap<String, Grant>,
}

/// The token -> folder registry. Managed as Tauri state.
pub struct FolderGrants {
    file: PathBuf,
    grants: Mutex<HashMap<String, Grant>>,
}

impl FolderGrants {
    /// Load the registry for this app. Never fails: without a readable grants
    /// file every stored token is simply dead and the user links the folder
    /// again - the same recovery as a lost bookmark on mobile.
    pub fn load(app: &AppHandle) -> Self {
        let file = app
            .path()
            .app_data_dir()
            .map(|dir| dir.join(GRANTS_FILE))
            .unwrap_or_else(|_| PathBuf::from(GRANTS_FILE));
        Self::open(file)
    }

    fn open(file: PathBuf) -> Self {
        let grants = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<GrantsDocument>(&bytes).ok())
            .map(|document| document.grants)
            .unwrap_or_default();
        Self {
            file,
            grants: Mutex::new(grants),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Grant>> {
        self.grants.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn get(&self, token: &str) -> Result<Grant, FolderFsError> {
        self.lock().get(token).cloned().ok_or(ACCESS_DENIED)
    }

    /// Register a folder and return its token. The grant only counts once it
    /// is on disk: a link that would vanish at the next launch is not handed
    /// out.
    fn add(&self, grant: Grant) -> Result<String, FolderFsError> {
        let token = random_hex().map_err(|_| STORE_FAILED)?;
        let mut grants = self.lock();
        grants.insert(token.clone(), grant);
        if self.persist(&grants).is_err() {
            grants.remove(&token);
            return Err(STORE_FAILED);
        }
        Ok(token)
    }

    /// Forget a token. Forgetting an unknown token is a success, so the call
    /// is safe to repeat.
    fn remove(&self, token: &str) -> Result<(), FolderFsError> {
        let mut grants = self.lock();
        let Some(removed) = grants.remove(token) else {
            return Ok(());
        };
        if self.persist(&grants).is_err() {
            grants.insert(token.to_owned(), removed);
            return Err(STORE_FAILED);
        }
        Ok(())
    }

    fn persist(&self, grants: &HashMap<String, Grant>) -> io::Result<()> {
        if let Some(parent) = self.file.parent() {
            fs::create_dir_all(parent)?;
        }
        let document = GrantsDocument {
            grants: grants.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&document).map_err(io::Error::other)?;
        write_atomic(&self.file, &bytes, true)
    }
}

/// 128 random bits as lowercase hex: grant tokens and temp-file suffixes.
fn random_hex() -> io::Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| io::Error::other("no random source"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// The folder behind a grant, symlinks resolved. Fails when it was moved or
/// deleted since it was linked.
fn root_of(grant: &Grant) -> Result<PathBuf, FolderFsError> {
    let root = fs::canonicalize(&grant.path).map_err(|_| FOLDER_NOT_FOUND)?;
    if !root.is_dir() {
        return Err(FOLDER_NOT_FOUND);
    }
    Ok(root)
}

/// Display name of a folder: its last path component.
fn leaf_name(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned())
}

/// Split a webview-supplied relative path into the segments below `root`.
///
/// Listings hand out `<leaf>/<sub>/<file>` (rooted at the folder's own name, the
/// shape the shared import engine expects) while the backup engine addresses
/// its flat files by bare name, so a leading segment equal to the folder name
/// is dropped - the same rule as the iOS plugin. Absolute paths and dot
/// segments are rejected outright, never normalized.
fn child_segments<'a>(root: &Path, relative: &'a str) -> Result<Vec<&'a str>, FolderFsError> {
    if relative.starts_with('/') || relative.contains('\0') {
        return Err(INVALID_PATH);
    }
    // `\` and `:` are separators / drive and stream markers on Windows only;
    // on macOS they are ordinary file-name characters.
    if cfg!(windows) && (relative.contains('\\') || relative.contains(':')) {
        return Err(INVALID_PATH);
    }
    let leaf = leaf_name(root);
    let mut segments: Vec<&str> = relative
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.first().is_some_and(|first| *first == leaf) {
        segments.remove(0);
    }
    if segments.is_empty()
        || segments
            .iter()
            .any(|segment| matches!(*segment, "." | ".."))
    {
        return Err(INVALID_PATH);
    }
    Ok(segments)
}

/// An existing file below `root` (which must be canonical). Symlinks are
/// resolved first, so a link pointing out of the folder is refused.
fn existing_child(root: &Path, relative: &str) -> Result<PathBuf, FolderFsError> {
    let mut path = root.to_path_buf();
    path.extend(child_segments(root, relative)?);
    let resolved = fs::canonicalize(&path).map_err(|_| FILE_NOT_FOUND)?;
    if !resolved.starts_with(root) {
        return Err(INVALID_PATH);
    }
    Ok(resolved)
}

/// A file below `root` that may not exist yet, for writes and deletes. The
/// parent directory is resolved and confined to the folder; the last
/// component is taken literally, so an existing symlink there is replaced or
/// removed itself, never followed.
fn target_child(root: &Path, relative: &str) -> Result<PathBuf, FolderFsError> {
    let segments = child_segments(root, relative)?;
    let (name, parents) = segments.split_last().ok_or(INVALID_PATH)?;
    let mut parent = root.to_path_buf();
    parent.extend(parents);
    let parent = fs::canonicalize(&parent).map_err(|_| FILE_NOT_FOUND)?;
    if !parent.starts_with(root) {
        return Err(INVALID_PATH);
    }
    Ok(parent.join(name))
}

// ---------------------------------------------------------------------------
// File operations (root is always the canonical folder of a grant)
// ---------------------------------------------------------------------------

/// One file found by a listing. Metadata only; content is read on demand.
#[derive(Debug, PartialEq, Serialize)]
pub struct FsEntry {
    /// `<leaf>/<sub>/<file>`, always `/`-separated.
    path: String,
    /// Last modification, whole milliseconds since the epoch (0 = unknown).
    mtime: f64,
    size: u64,
}

fn mtime_ms(metadata: &fs::Metadata) -> f64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| (elapsed.as_secs_f64() * 1000.0).floor())
        .unwrap_or(0.0)
}

fn has_extension(name: &str, extensions: &[String]) -> bool {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|extension| extensions.contains(&extension))
}

/// Recursively list the files with one of `extensions` (lowercase, no dot).
///
/// Mirrors the mobile walk: dot-prefixed files and directories are pruned
/// (`.obsidian/`, `.trash/`, our own temp files), an unreadable subdirectory
/// is skipped rather than failing the run. Symlinks are not listed and not
/// descended into - a listed file must be readable, and reads refuse to leave
/// the folder.
fn list_files(root: &Path, extensions: &[String]) -> Result<Vec<FsEntry>, FolderFsError> {
    let mut files = Vec::new();
    let mut pending = vec![(root.to_path_buf(), leaf_name(root), 0usize)];

    while let Some((directory, prefix, depth)) = pending.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) if depth == 0 => return Err(READ_FAILED),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let relative = format!("{prefix}/{name}");
            if kind.is_dir() {
                if depth < MAX_DEPTH {
                    pending.push((entry.path(), relative, depth + 1));
                }
                continue;
            }
            if !kind.is_file() || !has_extension(name, extensions) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            files.push(FsEntry {
                path: relative,
                mtime: mtime_ms(&metadata),
                size: metadata.len(),
            });
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Read one UTF-8 file and its modification time.
fn read_file(root: &Path, relative: &str) -> Result<(String, f64), FolderFsError> {
    let path = existing_child(root, relative)?;
    let metadata = fs::metadata(&path).map_err(|_| READ_FAILED)?;
    if !metadata.is_file() {
        return Err(READ_FAILED);
    }
    let content = fs::read_to_string(&path).map_err(|_| READ_FAILED)?;
    Ok((content, mtime_ms(&metadata)))
}

/// Write `bytes` to `target` so that a crash never leaves a truncated file:
/// the content goes to a hidden temp file in the same directory, is flushed
/// to disk and then renamed over the target. `private` restricts the file to
/// the current user (the grants file); backups keep the folder's defaults.
pub(crate) fn write_atomic(target: &Path, bytes: &[u8], private: bool) -> io::Result<()> {
    let invalid = || io::Error::from(io::ErrorKind::InvalidInput);
    let parent = target.parent().ok_or_else(invalid)?;
    let name = target.file_name().ok_or_else(invalid)?.to_string_lossy();
    let temp = parent.join(format!(".{name}.{}.tmp", random_hex()?));

    let written = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if private {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = private;
        let mut file = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, target)
    })();

    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written
}

/// Create or replace one UTF-8 file.
fn write_file(root: &Path, relative: &str, content: &str) -> Result<(), FolderFsError> {
    let target = target_child(root, relative)?;
    write_atomic(&target, content.as_bytes(), false).map_err(|_| WRITE_FAILED)
}

/// Delete one file. An already missing file is the desired end state.
fn delete_file(root: &Path, relative: &str) -> Result<(), FolderFsError> {
    let target = target_child(root, relative)?;
    match fs::symlink_metadata(&target) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(DELETE_FAILED),
        Ok(metadata) if metadata.is_dir() => Err(DELETE_FAILED),
        Ok(_) => fs::remove_file(&target).map_err(|_| DELETE_FAILED),
    }
}

// ---------------------------------------------------------------------------
// Commands (the FolderFs contract of `native-folder-fs.ts`)
// ---------------------------------------------------------------------------

/// Result of the folder dialog: a token and display name, or `cancelled`.
#[derive(Serialize)]
pub struct PickResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    bookmark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cancelled: Option<bool>,
}

#[derive(Serialize)]
pub struct ListResult {
    files: Vec<FsEntry>,
}

#[derive(Serialize)]
pub struct ReadResult {
    content: String,
    mtime: f64,
}

#[derive(Serialize)]
pub struct SameResult {
    same: bool,
}

/// Empty success payload: mobile returns `{ staleBookmark? }` here, and a
/// desktop token never goes stale.
#[derive(Serialize)]
pub struct Done {}

/// Show the system folder dialog and link the chosen folder.
#[tauri::command(async)]
pub fn folder_fs_pick_directory(
    window: WebviewWindow,
    grants: State<'_, FolderGrants>,
    write: Option<bool>,
) -> Result<PickResult, FolderFsError> {
    let Some(picked) = window
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder()
    else {
        return Ok(PickResult {
            bookmark: None,
            name: None,
            cancelled: Some(true),
        });
    };
    let path = picked.into_path().map_err(|_| PICK_FAILED)?;
    let root = fs::canonicalize(path).map_err(|_| PICK_FAILED)?;
    if !root.is_dir() {
        return Err(PICK_FAILED);
    }
    let name = leaf_name(&root);
    let bookmark = grants.add(Grant {
        path: root,
        write: write.unwrap_or(false),
    })?;
    Ok(PickResult {
        bookmark: Some(bookmark),
        name: Some(name),
        cancelled: None,
    })
}

/// List the files with the given extensions (default: Markdown).
#[tauri::command(async)]
pub fn folder_fs_list_files(
    grants: State<'_, FolderGrants>,
    bookmark: String,
    extensions: Option<Vec<String>>,
) -> Result<ListResult, FolderFsError> {
    let root = root_of(&grants.get(&bookmark)?)?;
    let extensions: Vec<String> = extensions
        .filter(|list| !list.is_empty())
        .unwrap_or_else(|| vec!["md".to_owned()])
        .iter()
        .map(|extension| extension.to_ascii_lowercase())
        .collect();
    Ok(ListResult {
        files: list_files(&root, &extensions)?,
    })
}

/// Read one file's UTF-8 content.
#[tauri::command(async)]
pub fn folder_fs_read_file(
    grants: State<'_, FolderGrants>,
    bookmark: String,
    path: String,
) -> Result<ReadResult, FolderFsError> {
    let root = root_of(&grants.get(&bookmark)?)?;
    let (content, mtime) = read_file(&root, &path)?;
    Ok(ReadResult { content, mtime })
}

/// Whether two tokens point at the same folder on disk.
#[tauri::command(async)]
pub fn folder_fs_is_same_directory(
    grants: State<'_, FolderGrants>,
    a: String,
    b: String,
) -> Result<SameResult, FolderFsError> {
    let first = root_of(&grants.get(&a)?)?;
    let second = root_of(&grants.get(&b)?)?;
    Ok(SameResult {
        same: first == second,
    })
}

/// Create or replace one file. Needs a folder linked with `write: true`.
#[tauri::command(async)]
pub fn folder_fs_write_file(
    grants: State<'_, FolderGrants>,
    bookmark: String,
    path: String,
    content: String,
) -> Result<Done, FolderFsError> {
    let grant = grants.get(&bookmark)?;
    if !grant.write {
        return Err(ACCESS_DENIED);
    }
    write_file(&root_of(&grant)?, &path, &content)?;
    Ok(Done {})
}

/// Delete one file. Needs a folder linked with `write: true`.
#[tauri::command(async)]
pub fn folder_fs_delete_file(
    grants: State<'_, FolderGrants>,
    bookmark: String,
    path: String,
) -> Result<Done, FolderFsError> {
    let grant = grants.get(&bookmark)?;
    if !grant.write {
        return Err(ACCESS_DENIED);
    }
    delete_file(&root_of(&grant)?, &path)?;
    Ok(Done {})
}

/// Forget a linked folder: its token stops working.
#[tauri::command(async)]
pub fn folder_fs_release_directory(
    grants: State<'_, FolderGrants>,
    bookmark: String,
) -> Result<(), FolderFsError> {
    grants.remove(&bookmark)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, canonical scratch directory, removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("folder-fs-test-{}", random_hex().unwrap()));
            fs::create_dir_all(&path).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }

        /// Create `relative` (with its parent directories) below the scratch root.
        fn file(&self, relative: &str, content: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, content).unwrap();
            path
        }

        fn dir(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(&path).unwrap();
            path
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn md() -> Vec<String> {
        vec!["md".to_owned()]
    }

    fn listed(root: &Path, extensions: &[String]) -> Vec<String> {
        list_files(root, extensions)
            .unwrap()
            .into_iter()
            .map(|entry| entry.path)
            .collect()
    }

    #[test]
    fn lists_markdown_rooted_at_the_folder_name() {
        let scratch = Scratch::new();
        let vault = scratch.dir("Vault");
        scratch.file("Vault/b.md", "b");
        scratch.file("Vault/A.MD", "a");
        scratch.file("Vault/sub/deep/c.md", "c");
        scratch.file("Vault/notes.txt", "skip");
        scratch.file("Vault/no-extension", "skip");

        assert_eq!(
            listed(&vault, &md()),
            ["Vault/A.MD", "Vault/b.md", "Vault/sub/deep/c.md"]
        );
    }

    #[test]
    fn prunes_hidden_files_and_directories() {
        let scratch = Scratch::new();
        let vault = scratch.dir("Vault");
        scratch.file("Vault/kept.md", "x");
        scratch.file("Vault/.hidden.md", "x");
        scratch.file("Vault/.obsidian/config.md", "x");
        scratch.file("Vault/.trash/old.md", "x");

        assert_eq!(listed(&vault, &md()), ["Vault/kept.md"]);
    }

    #[test]
    fn reports_size_and_a_whole_millisecond_mtime() {
        let scratch = Scratch::new();
        let vault = scratch.dir("Vault");
        scratch.file("Vault/note.md", "hello");

        let entries = list_files(&vault, &md()).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].size, 5);
        assert!(entries[0].mtime > 0.0);
        assert_eq!(entries[0].mtime.fract(), 0.0);
    }

    #[test]
    fn lists_other_extensions_on_request() {
        let scratch = Scratch::new();
        let backups = scratch.dir("Backups");
        scratch.file("Backups/one.json", "{}");
        scratch.file("Backups/note.md", "x");

        assert_eq!(listed(&backups, &["json".to_owned()]), ["Backups/one.json"]);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_list_or_follow_symlinks() {
        let scratch = Scratch::new();
        let vault = scratch.dir("Vault");
        let outside = scratch.file("outside/secret.md", "secret");
        scratch.file("Vault/real.md", "x");
        std::os::unix::fs::symlink(&outside, vault.join("link.md")).unwrap();
        std::os::unix::fs::symlink(outside.parent().unwrap(), vault.join("linked-dir")).unwrap();

        assert_eq!(listed(&vault, &md()), ["Vault/real.md"]);
    }

    #[test]
    fn listing_a_missing_folder_fails() {
        let scratch = Scratch::new();

        assert_eq!(list_files(&scratch.0.join("gone"), &md()), Err(READ_FAILED));
    }

    #[test]
    fn reads_by_listed_path_and_by_bare_name() {
        let scratch = Scratch::new();
        let vault = scratch.dir("Vault");
        scratch.file("Vault/sub/note.md", "zażółć");
        scratch.file("Vault/flat.json", "{}");

        let (content, mtime) = read_file(&vault, "Vault/sub/note.md").unwrap();
        assert_eq!(content, "zażółć");
        assert!(mtime > 0.0);
        assert_eq!(read_file(&vault, "flat.json").unwrap().0, "{}");
    }

    #[test]
    fn rejects_paths_that_leave_the_folder() {
        let scratch = Scratch::new();
        let vault = scratch.dir("Vault");
        scratch.file("secret.md", "secret");

        for path in [
            "../secret.md",
            "Vault/../../secret.md",
            "sub/../../secret.md",
            "./secret.md",
            "/etc/hosts",
            "",
            "Vault",
            "a\0b.md",
        ] {
            assert_eq!(read_file(&vault, path), Err(INVALID_PATH), "read {path:?}");
            assert_eq!(
                write_file(&vault, path, "x"),
                Err(INVALID_PATH),
                "write {path:?}"
            );
            assert_eq!(
                delete_file(&vault, path),
                Err(INVALID_PATH),
                "delete {path:?}"
            );
        }
        assert_eq!(
            fs::read_to_string(scratch.0.join("secret.md")).unwrap(),
            "secret"
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_read_through_a_symlink_out_of_the_folder() {
        let scratch = Scratch::new();
        let vault = scratch.dir("Vault");
        let outside = scratch.file("outside/secret.md", "secret");
        std::os::unix::fs::symlink(&outside, vault.join("link.md")).unwrap();
        std::os::unix::fs::symlink(outside.parent().unwrap(), vault.join("linked-dir")).unwrap();

        assert_eq!(read_file(&vault, "link.md"), Err(INVALID_PATH));
        assert_eq!(read_file(&vault, "linked-dir/secret.md"), Err(INVALID_PATH));
        assert_eq!(
            write_file(&vault, "linked-dir/planted.md", "x"),
            Err(INVALID_PATH)
        );
        assert!(!outside.parent().unwrap().join("planted.md").exists());
    }

    #[test]
    fn reading_a_missing_file_is_reported_as_such() {
        let scratch = Scratch::new();
        let vault = scratch.dir("Vault");

        assert_eq!(read_file(&vault, "Vault/gone.md"), Err(FILE_NOT_FOUND));
    }

    #[test]
    fn reading_a_directory_or_invalid_utf8_fails() {
        let scratch = Scratch::new();
        let vault = scratch.dir("Vault");
        scratch.dir("Vault/sub");
        fs::write(vault.join("binary.md"), [0xff, 0xfe, 0x00]).unwrap();

        assert_eq!(read_file(&vault, "sub"), Err(READ_FAILED));
        assert_eq!(read_file(&vault, "binary.md"), Err(READ_FAILED));
    }

    #[test]
    fn writes_create_and_replace_without_leaving_temp_files() {
        let scratch = Scratch::new();
        let backups = scratch.dir("Backups");

        write_file(&backups, "backup.json", "first").unwrap();
        write_file(&backups, "backup.json", "second").unwrap();

        assert_eq!(
            fs::read_to_string(backups.join("backup.json")).unwrap(),
            "second"
        );
        let names: Vec<String> = fs::read_dir(&backups)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["backup.json"]);
    }

    #[test]
    fn writing_into_a_missing_subdirectory_fails() {
        let scratch = Scratch::new();
        let backups = scratch.dir("Backups");

        assert_eq!(
            write_file(&backups, "missing/backup.json", "x"),
            Err(FILE_NOT_FOUND)
        );
    }

    #[cfg(unix)]
    #[test]
    fn writing_over_a_symlink_replaces_the_link_not_its_target() {
        let scratch = Scratch::new();
        let backups = scratch.dir("Backups");
        let outside = scratch.file("outside/victim.json", "untouched");
        std::os::unix::fs::symlink(&outside, backups.join("backup.json")).unwrap();

        write_file(&backups, "backup.json", "new").unwrap();

        assert_eq!(fs::read_to_string(&outside).unwrap(), "untouched");
        assert_eq!(
            fs::read_to_string(backups.join("backup.json")).unwrap(),
            "new"
        );
    }

    #[test]
    fn delete_is_idempotent_and_refuses_directories() {
        let scratch = Scratch::new();
        let backups = scratch.dir("Backups");
        scratch.file("Backups/old.json", "x");
        scratch.dir("Backups/sub");

        delete_file(&backups, "old.json").unwrap();
        delete_file(&backups, "old.json").unwrap();

        assert!(!backups.join("old.json").exists());
        assert_eq!(delete_file(&backups, "sub"), Err(DELETE_FAILED));
        assert!(backups.join("sub").is_dir());
    }

    #[test]
    fn grants_survive_a_restart_and_can_be_released() {
        let scratch = Scratch::new();
        let file = scratch.0.join("data/folder-grants.json");
        let folder = scratch.dir("Vault");
        let grant = Grant {
            path: folder.clone(),
            write: true,
        };

        let token = FolderGrants::open(file.clone()).add(grant.clone()).unwrap();

        let reopened = FolderGrants::open(file.clone());
        assert_eq!(reopened.get(&token), Ok(grant));
        assert_eq!(root_of(&reopened.get(&token).unwrap()), Ok(folder));

        reopened.remove(&token).unwrap();
        reopened.remove(&token).unwrap();
        assert_eq!(FolderGrants::open(file).get(&token), Err(ACCESS_DENIED));
    }

    #[test]
    fn tokens_are_unguessable_and_unique() {
        let scratch = Scratch::new();
        let grants = FolderGrants::open(scratch.0.join("folder-grants.json"));
        let grant = Grant {
            path: scratch.0.clone(),
            write: false,
        };

        let first = grants.add(grant.clone()).unwrap();
        let second = grants.add(grant).unwrap();

        assert_ne!(first, second);
        assert_eq!(first.len(), 32);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn unknown_tokens_and_a_corrupt_file_grant_nothing() {
        let scratch = Scratch::new();
        let file = scratch.file("folder-grants.json", "{ not json");

        let grants = FolderGrants::open(file);

        assert_eq!(grants.get("/etc"), Err(ACCESS_DENIED));
        assert_eq!(grants.get(""), Err(ACCESS_DENIED));
    }

    #[test]
    fn a_folder_removed_after_linking_is_reported_as_gone() {
        let scratch = Scratch::new();
        let grant = Grant {
            path: scratch.0.join("moved-away"),
            write: false,
        };

        assert_eq!(root_of(&grant), Err(FOLDER_NOT_FOUND));
    }

    #[cfg(unix)]
    #[test]
    fn the_grants_file_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;

        let scratch = Scratch::new();
        let file = scratch.0.join("folder-grants.json");
        let grants = FolderGrants::open(file.clone());
        grants
            .add(Grant {
                path: scratch.0.clone(),
                write: false,
            })
            .unwrap();

        let mode = fs::metadata(&file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
