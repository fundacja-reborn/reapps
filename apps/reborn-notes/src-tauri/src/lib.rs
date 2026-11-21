//! re/notes desktop shell (Tauri 2).
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
//! - `file_export_save`: "Save as..." for exports;
//! - `app_lock_*`: the system unlock prompt for App Lock (Touch ID or the
//!   account password on macOS);
//! - `app_info`: version and build of the app for Settings;
//! - `desktop_menu_localize`: the app menu in the app's language (macOS).
//!
//! Window chrome (brand-yellow title bar) is pure configuration, see
//! `tauri.conf.json`. Window size and position persist through
//! `tauri-plugin-window-state` (Rust side only).

mod app_info;
mod app_lock;
mod app_menu;
mod file_export;
mod folder_fs;
mod secure_storage;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

/// What the window remembers between launches. Not the full screen state: a
/// window restored straight into full screen opens in its own Space, which is
/// more surprising than helpful. Not visibility or decorations either - the
/// window always opens visible, with the chrome from `tauri.conf.json`.
fn window_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags())
                .build(),
        );

    // The menu bar is a macOS thing; Windows and Linux get none (D5).
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app| {
            let (menu, texts) = app_menu::build(app)?;
            app.manage(texts);
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            if event.id().as_ref() == app_menu::SETTINGS_ITEM_ID {
                // Best effort: without a listener (page still loading) the
                // click simply does nothing.
                let _ = app.emit(app_menu::OPEN_SETTINGS_EVENT, ());
            }
        });

    builder
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
            file_export::file_export_save,
            app_lock::app_lock_status,
            app_lock::app_lock_authenticate,
            app_info::app_info,
            app_menu::desktop_menu_localize
        ])
        .run(tauri::generate_context!())
        .expect("error while running the re/notes desktop shell");
}
