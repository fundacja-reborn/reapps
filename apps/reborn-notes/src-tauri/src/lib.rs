//! re/notes desktop shell (Tauri 2) - D0 spike.
//!
//! The shell bundles the same static SPA build as the Capacitor shells and
//! loads it from the local `tauri://localhost` origin. Loading code locally,
//! never over the network, is the point (structural mitigation of CORE-12).
//!
//! The native surface is deliberately tiny:
//! - `tauri-plugin-http`: transport for the remote API (no server CORS);
//! - `secure_storage_*`: refresh token and master key in the OS credential
//!   store.
//!
//! Window chrome (brand-yellow title bar) is pure configuration, see
//! `tauri.conf.json`.

mod secure_storage;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            secure_storage::secure_storage_get,
            secure_storage::secure_storage_set,
            secure_storage::secure_storage_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running the re/notes desktop shell");
}
