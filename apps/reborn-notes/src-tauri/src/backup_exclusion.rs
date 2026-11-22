//! Keeps the webview's local data out of Time Machine (macOS).
//!
//! The Zero Knowledge invariant is that only ciphertext leaves the device.
//! The webview's store holds IndexedDB with decrypted shadow indexes (note
//! titles, folder names used for sort and filter) plus the access token in
//! localStorage. On macOS WebKit keeps it in `~/Library/WebKit/<bundle id>`,
//! which Time Machine backs up by default, so without the flag that plaintext
//! would ride every backup. This is the desktop counterpart of the iOS shell
//! keeping `Library/WebKit` out of iCloud and Finder backups
//! (`AppDelegate.excludeWebDataFromBackup`).
//!
//! The flag is `NSURLIsExcludedFromBackupKey` on the directory itself: a
//! sticky exclusion stored with the item (the same attribute `tmutil
//! addexclusion` writes), which Time Machine honours for everything inside,
//! including files WebKit creates later, and which needs no admin rights
//! (unlike a fixed-path exclusion, `tmutil addexclusion -p`). It is applied on
//! every launch before the window exists, and the directories are created
//! first, so on a fresh install the flag is there before WebKit's first write.
//!
//! Excluded, each as `~/Library/<dir>/<bundle id>`:
//! - `WebKit`: IndexedDB and localStorage, the reason for this module;
//! - `Caches`: WebKit's network cache and cache storage. Time Machine already
//!   skips `~/Library/Caches` through its standard exclusions; the flag keeps
//!   that true even if the policy changes.
//!
//! Left in backups on purpose: `Application Support/<bundle id>` (the linked
//! folder registry and the window geometry - folder paths and sizes, no note
//! content). The login keychain (master key and refresh token) is backed up
//! by the system, encrypted with the account password; keeping those items
//! on this Mac only, like the iOS Keychain class `ThisDeviceOnly`, is a
//! separate item.
//!
//! Restoring loses nothing that matters: the local store is a copy of the
//! server's ciphertext and is synced again after a restore; the sanctioned
//! local backup is the app's phrase-encrypted backup.
//!
//! Mac App Store (D4): in the sandbox `~/Library` is the app container's; where
//! WebKit keeps the store there is to be checked with `tmutil isexcluded` on
//! that build. Windows (D5): WebView2 keeps its data under `%LOCALAPPDATA%`,
//! which neither roams nor is in File History's default set; nothing is
//! flagged there, to be confirmed in D5.

use std::path::{Component, Path, PathBuf};

/// Directories of `~/Library` that hold the webview's data, each followed by
/// the bundle identifier.
const LIBRARY_DIRS: [&str; 2] = ["WebKit", "Caches"];

/// Whether `name` is a single plain path segment (no separators, not `.` or
/// `..`), so joining it cannot leave the directory it is joined to.
fn is_plain_name(name: &str) -> bool {
    let mut parts = Path::new(name).components();
    matches!(
        (parts.next(), parts.next()),
        (Some(Component::Normal(_)), None)
    ) && !name.contains(['/', '\\'])
}

/// The directories to exclude: `<library>/<dir>/<bundle id>`. Empty when the
/// identifier is not a plain name (it comes from the compiled-in config, so
/// this only guards against a broken config flagging a shared directory).
fn excluded_dirs(library: &Path, bundle_id: &str) -> Vec<PathBuf> {
    if !is_plain_name(bundle_id) {
        return Vec::new();
    }
    LIBRARY_DIRS
        .iter()
        .map(|dir| library.join(dir).join(bundle_id))
        .collect()
}

/// Flags the webview's data directories as excluded from backups. Call before
/// any window is created.
///
/// Best effort: a failure is reported on stderr and the app still starts. An
/// unflagged directory is the state before this module existed, not a new
/// leak, and refusing to start would lock the user out of their notes.
pub fn exclude_web_data(bundle_id: &str) {
    #[cfg(target_os = "macos")]
    macos::exclude_web_data(bundle_id);
    #[cfg(not(target_os = "macos"))]
    let _ = bundle_id;
}

#[cfg(target_os = "macos")]
mod macos {
    use super::excluded_dirs;
    use objc2_foundation::{
        NSFileManager, NSNumber, NSSearchPathDirectory, NSSearchPathDomainMask, NSString,
        NSURLIsExcludedFromBackupKey, NSURL,
    };
    use std::path::{Path, PathBuf};

    /// `~/Library` of the running app (inside its container when sandboxed).
    fn library_dir() -> Option<PathBuf> {
        let urls = NSFileManager::defaultManager().URLsForDirectory_inDomains(
            NSSearchPathDirectory::LibraryDirectory,
            NSSearchPathDomainMask::UserDomainMask,
        );
        let path = urls.firstObject()?.path()?;
        Some(PathBuf::from(path.to_string()))
    }

    fn directory_url(dir: &Path) -> Result<objc2::rc::Retained<NSURL>, String> {
        let path = dir.to_str().ok_or("path is not valid UTF-8")?;
        Ok(NSURL::fileURLWithPath_isDirectory(
            &NSString::from_str(path),
            true,
        ))
    }

    /// Excludes an existing directory from backups. One way only: setting the
    /// key back to `false` did not remove the flag in our tests (see
    /// `has_exclusion_flag`), and the app never needs to.
    pub(super) fn exclude(dir: &Path) -> Result<(), String> {
        let url = directory_url(dir)?;
        let value = NSNumber::new_bool(true);
        // SAFETY: reading an immutable Foundation constant; the key takes an
        // NSNumber holding a BOOL, which is what `value` is.
        unsafe { url.setResourceValue_forKey_error(Some(&value), NSURLIsExcludedFromBackupKey) }
            .map_err(|error| error.localizedDescription().to_string())
    }

    /// Whether a directory carries the sticky exclusion Time Machine reads:
    /// the `com.apple.metadata:com_apple_backup_excludeItem` attribute, which
    /// `exclude` writes byte for byte as `tmutil addexclusion` does.
    ///
    /// Not read back through Foundation: `getResourceValue` with the same key
    /// and `CSBackupIsItemExcluded` both answered `false` (2026-11-22, macOS
    /// 27.2, tests run from a sandboxed shell) even for a directory excluded
    /// with `tmutil addexclusion`. Not through `tmutil isexcluded` either: it
    /// also reports path exclusions, and the system already skips the
    /// temporary directory the tests use.
    #[cfg(test)]
    pub(super) fn has_exclusion_flag(dir: &Path) -> bool {
        use std::ffi::{c_char, c_int, c_void, CString};
        use std::os::unix::ffi::OsStrExt;

        extern "C" {
            fn getxattr(
                path: *const c_char,
                name: *const c_char,
                value: *mut c_void,
                size: usize,
                position: u32,
                options: c_int,
            ) -> isize;
        }

        let path = CString::new(dir.as_os_str().as_bytes()).expect("path without NUL");
        let name = c"com.apple.metadata:com_apple_backup_excludeItem";
        // SAFETY: both strings are NUL-terminated and outlive the call; a null
        // buffer of size 0 only asks for the attribute's size.
        let size = unsafe { getxattr(path.as_ptr(), name.as_ptr(), std::ptr::null_mut(), 0, 0, 0) };
        size > 0
    }

    pub(super) fn exclude_web_data(bundle_id: &str) {
        let Some(library) = library_dir() else {
            eprintln!("re/notes: no Library directory, web data stays in backups");
            return;
        };
        exclude_in(&library, bundle_id);
    }

    /// Creates the app's directories under `library` if needed and flags them.
    pub(super) fn exclude_in(library: &Path, bundle_id: &str) {
        for dir in excluded_dirs(library, bundle_id) {
            if let Err(error) = std::fs::create_dir_all(&dir) {
                eprintln!(
                    "re/notes: could not create {} for backup exclusion: {error}",
                    dir.display()
                );
                continue;
            }
            if let Err(error) = exclude(&dir) {
                eprintln!(
                    "re/notes: could not exclude {} from backups: {error}",
                    dir.display()
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_the_webkit_and_cache_directories_of_the_app() {
        let library = Path::new("/Users/someone/Library");
        assert_eq!(
            excluded_dirs(library, "eu.reapps.notes"),
            [
                PathBuf::from("/Users/someone/Library/WebKit/eu.reapps.notes"),
                PathBuf::from("/Users/someone/Library/Caches/eu.reapps.notes"),
            ]
        );
    }

    #[test]
    fn never_flags_a_shared_directory_for_a_broken_identifier() {
        let library = Path::new("/Users/someone/Library");
        for id in ["", ".", "..", "a/b", "/abs", "../x", "a\\b", "x/"] {
            assert!(excluded_dirs(library, id).is_empty(), "{id:?}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn flags_a_directory_for_time_machine() {
        let dir =
            std::env::temp_dir().join(format!("backup-exclusion-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let before = macos::has_exclusion_flag(&dir);
        macos::exclude(&dir).unwrap();
        let after = macos::has_exclusion_flag(&dir);
        let _ = std::fs::remove_dir_all(&dir);

        assert!(!before);
        assert!(after);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn creates_and_flags_the_directories_before_webkit_does() {
        let library =
            std::env::temp_dir().join(format!("backup-exclusion-library-{}", std::process::id()));
        // An existing store (a later launch) and a missing one (first launch).
        std::fs::create_dir_all(library.join("WebKit/eu.reapps.test/WebsiteData")).unwrap();

        macos::exclude_in(&library, "eu.reapps.test");
        let webkit = macos::has_exclusion_flag(&library.join("WebKit/eu.reapps.test"));
        let caches = macos::has_exclusion_flag(&library.join("Caches/eu.reapps.test"));
        let shared = macos::has_exclusion_flag(&library.join("WebKit"));
        let _ = std::fs::remove_dir_all(&library);

        assert!(webkit);
        assert!(caches);
        assert!(!shared, "the shared WebKit directory must stay untouched");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reports_a_missing_directory_instead_of_creating_it() {
        let dir =
            std::env::temp_dir().join(format!("backup-exclusion-missing-{}", std::process::id()));

        assert!(macos::exclude(&dir).is_err());
        assert!(!dir.exists());
    }
}
