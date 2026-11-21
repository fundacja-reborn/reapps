//! re/notes desktop shell (Tauri 2) - D0 spike.
//!
//! The shell bundles the same static SPA build as the Capacitor shells and
//! loads it from the local `tauri://localhost` origin. Loading code locally,
//! never over the network, is the point (structural mitigation of CORE-12).
//!
//! The native surface is deliberately small:
//! - `tauri-plugin-http`: transport for the remote API (no server CORS);
//! - `secure_storage_*`: refresh token and master key in the OS credential
//!   store;
//! - `folder_fs_*`: access to folders the user linked through the system
//!   dialog (folder sync, automated backup);
//! - `file_export_save`: "Save as..." for exports.
//!
//! Window chrome (brand-yellow title bar) is pure configuration, see
//! `tauri.conf.json`.

mod file_export;
mod folder_fs;
mod secure_storage;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(folder_fs::FolderGrants::load(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secure_storage::secure_storage_get,
            secure_storage::secure_storage_set,
            secure_storage::secure_storage_remove,
            folder_fs::folder_fs_pick_directory,
            folder_fs::folder_fs_list_files,
            folder_fs::folder_fs_read_file,
            folder_fs::folder_fs_is_same_directory,
            folder_fs::folder_fs_write_file,
            folder_fs::folder_fs_delete_file,
            folder_fs::folder_fs_release_directory,
            file_export::file_export_save
        ])
        .run(tauri::generate_context!())
        .expect("error while running the re/notes desktop shell");
}
