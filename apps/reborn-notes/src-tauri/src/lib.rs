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
//! Window chrome: a transparent title bar (`tauri.conf.json`) over the
//! brand-yellow window background (`paint_title_bar`). Window size and
//! position persist through `tauri-plugin-window-state` (Rust side only).
//!
//! The webview's data (IndexedDB with decrypted shadow indexes) is kept out
//! of Time Machine at every launch (`backup_exclusion`).

mod app_info;
mod app_lock;
mod app_menu;
mod backup_exclusion;
mod file_export;
mod folder_fs;
mod secure_storage;

use tauri::window::Color;
use tauri::{AppHandle, Manager, Runtime, Webview};
use tauri_plugin_window_state::StateFlags;

/// Label of the only window, from `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";

/// Brand yellow (#FFD43B), seen through the transparent title bar.
const TITLE_BAR_COLOR: Color = Color(0xFF, 0xD4, 0x3B, 0xFF);

/// Paints the native window (not the webview) brand yellow, so the
/// transparent title bar shows it.
///
/// Not through `backgroundColor` in `tauri.conf.json`: that one goes to the
/// webview too, where wry turns off the WKWebView's own background through
/// `drawsBackground`, a private WebKit key (a risk for Mac App Store review,
/// D4). The webview keeps its default opaque background, the page paints its
/// own, and WebKit gets the simpler opaque case. (Stale paint in the editor is
/// a separate WebKit issue, see `src/lib/editor/desktop-repaint.ts`.)
fn paint_title_bar<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let webview: &Webview<R> = window.as_ref();
    // Best effort: a failure leaves the system title bar color, nothing else.
    let _ = webview.window().set_background_color(Some(TITLE_BAR_COLOR));
}

/// What the window remembers between launches. Not the full screen state: a
/// window restored straight into full screen opens in its own Space, which is
/// more surprising than helpful. Not visibility or decorations either - the
/// window always opens visible, with the chrome from `tauri.conf.json`.
fn window_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

pub fn run() {
    let context = tauri::generate_context!();
    // Before the window (and with it WebKit) exists, so on a fresh install the
    // flag is set before the first write to the webview's store.
    backup_exclusion::exclude_web_data(&context.config().identifier);

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
            paint_title_bar(app.handle());
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
        .run(context)
        .expect("error while running the re/notes desktop shell");
}
