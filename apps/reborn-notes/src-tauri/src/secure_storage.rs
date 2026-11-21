//! OS credential store access for the webview (macOS Keychain, Windows
//! Credential Manager), the desktop counterpart of the Capacitor
//! secure-storage plugin.
//!
//! Holds the rotating refresh token and the master key. Zero Knowledge rules
//! for this module:
//! - values never appear in logs or in error messages (errors are fixed
//!   strings, the underlying OS error is dropped on purpose);
//! - nothing here talks to the network;
//! - entries are namespaced by the bundle identifier, so a spike build and a
//!   store build never read each other's secrets.

use keyring::{Entry, Error};
use tauri::AppHandle;

/// Longest key the webview may address. The app uses a handful of short,
/// fixed names; the cap only bounds what a compromised page could create.
const MAX_KEY_LEN: usize = 64;

fn entry(app: &AppHandle, key: &str) -> Result<Entry, String> {
    let valid = !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    if !valid {
        return Err("secure storage: invalid key".into());
    }
    Entry::new(&app.config().identifier, key)
        .map_err(|_| "secure storage: store unavailable".to_string())
}

/// Read an entry. `None` when it does not exist.
#[tauri::command(async)]
pub fn secure_storage_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    match entry(&app, &key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err("secure storage: read failed".into()),
    }
}

/// Create or replace an entry.
#[tauri::command(async)]
pub fn secure_storage_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    entry(&app, &key)?
        .set_password(&value)
        .map_err(|_| "secure storage: write failed".to_string())
}

/// Delete an entry. Deleting a missing entry is a success (idempotent logout).
#[tauri::command(async)]
pub fn secure_storage_remove(app: AppHandle, key: String) -> Result<(), String> {
    match entry(&app, &key)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(_) => Err("secure storage: delete failed".into()),
    }
}
