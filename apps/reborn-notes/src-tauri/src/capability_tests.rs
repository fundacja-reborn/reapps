//! What the page may call through IPC, checked against the real ACL.
//!
//! The app is built on Tauri's mock runtime from the shell's own generated
//! context (`tauri.conf.json`, `capabilities/`, the app manifest from
//! `build.rs`), so the capability resolution is the one the shipped binary
//! uses. The mock app registers no commands and no plugins: a call the ACL lets
//! through ends in "not found", a refused one in "not allowed". That is enough
//! to tell the two apart without running any command.

use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::MAIN_WINDOW;

/// The local origin the bundled page is served from on macOS.
const LOCAL_URL: &str = "tauri://localhost";

/// Every command the page calls (`build.rs` declares the same list).
const PAGE_COMMANDS: &[&str] = &[
    "secure_storage_get",
    "secure_storage_set",
    "secure_storage_remove",
    "folder_fs_pick_directory",
    "folder_fs_list_files",
    "folder_fs_read_file",
    "folder_fs_is_same_directory",
    "folder_fs_write_file",
    "folder_fs_delete_file",
    "folder_fs_release_directory",
    "file_export_save",
    "app_lock_status",
    "app_lock_authenticate",
    "app_info",
    "desktop_menu_localize",
    "backup_reminder_status",
    "backup_reminder_request_permission",
    "backup_reminder_schedule",
    "backup_reminder_cancel",
];

fn mock_app() -> App<MockRuntime> {
    mock_builder()
        .build(tauri::generate_context!(test = true))
        .expect("mock app")
}

fn main_window(app: &App<MockRuntime>) -> WebviewWindow<MockRuntime> {
    app.get_webview_window(MAIN_WINDOW).unwrap_or_else(|| {
        WebviewWindowBuilder::new(app, MAIN_WINDOW, Default::default())
            .build()
            .expect("main window")
    })
}

/// The rejection message of an IPC call, or `None` when it succeeded.
fn call_from(window: &WebviewWindow<MockRuntime>, cmd: &str, url: &str) -> Option<String> {
    let request = InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: url.parse().expect("url"),
        body: InvokeBody::default(),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    match get_ipc_response(window, request) {
        Ok(_) => None,
        Err(Value::String(message)) => Some(message),
        Err(other) => Some(other.to_string()),
    }
}

/// True when the ACL refused the call (debug and release word it alike).
fn refused(window: &WebviewWindow<MockRuntime>, cmd: &str) -> bool {
    refused_from(window, cmd, LOCAL_URL)
}

fn refused_from(window: &WebviewWindow<MockRuntime>, cmd: &str, url: &str) -> bool {
    call_from(window, cmd, url).is_some_and(|message| message.contains("not allowed"))
}

#[test]
fn page_reaches_each_of_its_commands() {
    let app = mock_app();
    let window = main_window(&app);
    for command in PAGE_COMMANDS {
        assert!(!refused(&window, command), "{command} refused");
    }
}

#[test]
fn page_is_refused_an_undeclared_command() {
    let app = mock_app();
    let window = main_window(&app);
    // Registering a command is not enough: without its permission the page
    // cannot call it.
    assert!(refused(&window, "secure_storage_list"));
}

#[test]
fn page_reaches_the_http_transport_and_event_listening() {
    let app = mock_app();
    let window = main_window(&app);
    for command in [
        "plugin:http|fetch",
        "plugin:http|fetch_send",
        "plugin:http|fetch_read_body",
        "plugin:http|fetch_cancel",
        "plugin:http|fetch_cancel_body",
        "plugin:event|listen",
        "plugin:event|unlisten",
    ] {
        assert!(!refused(&window, command), "{command} refused");
    }
}

#[test]
fn page_is_refused_the_rest_of_core() {
    let app = mock_app();
    let window = main_window(&app);
    for command in [
        // The app menu is built by the shell only.
        "plugin:menu|new",
        "plugin:menu|set_as_app_menu",
        // The window and webview are not the page's to drive.
        "plugin:window|close",
        "plugin:window|set_title",
        "plugin:window|set_size",
        "plugin:webview|set_webview_zoom",
        "plugin:webview|internal_toggle_devtools",
        // Nothing to learn about the install or the file system.
        "plugin:app|version",
        "plugin:path|resolve_directory",
        // Events go from the shell to the page, never the other way.
        "plugin:event|emit",
        "plugin:event|emit_to",
        // No plugin API beyond the HTTP transport.
        "plugin:dialog|open",
        "plugin:dialog|message",
        "plugin:window-state|save_window_state",
    ] {
        assert!(refused(&window, command), "{command} allowed");
    }
}

#[test]
fn remote_content_reaches_nothing() {
    let app = mock_app();
    let window = main_window(&app);
    for command in ["app_info", "secure_storage_get", "plugin:http|fetch"] {
        assert!(
            refused_from(&window, command, "https://example.com"),
            "{command} allowed from a remote origin"
        );
    }
}

#[cfg(debug_assertions)]
#[test]
fn debug_build_adds_the_devtools_shortcut() {
    let app = mock_app();
    let window = main_window(&app);
    let toggle = "plugin:webview|internal_toggle_devtools";
    assert!(refused(&window, toggle));
    crate::allow_devtools_shortcut(app.handle());
    assert!(!refused(&window, toggle));
}
