//! The application menu on macOS.
//!
//! macOS expects a menu bar: without the Edit menu Cmd+C / V / A do not reach
//! the webview at all. This one is the standard set, in the order of Apple's
//! guidelines:
//!
//! - re/notes: About, Settings... (Cmd+,), Services, Hide, Hide Others,
//!   Show All, Quit;
//! - Edit: Undo, Redo, Cut, Copy, Paste, Select All;
//! - View: full screen;
//! - Window: Minimize, Zoom, Close Window.
//!
//! The texts follow the app's language, not the system's: the page sends them
//! at startup and on every language change (`desktop_menu_localize`, keys
//! `desktop.menu.*` in the notes translations). Until then the menu shows the
//! English texts below. Items macOS adds itself (dictation and emoji in Edit,
//! the window list, the full screen item, which AppKit retitles) stay in the
//! system language.
//!
//! Windows and Linux get no menu bar (D5), so `build` only runs on macOS and the
//! localize command is a no-op elsewhere.

use std::collections::HashMap;

use tauri::menu::{
    AboutMetadata, IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Manager, Runtime, Wry};

use crate::app_info;

/// Menu id of "Settings...".
pub const SETTINGS_ITEM_ID: &str = "settings";

/// Event the page listens to; the menu emits it for "Settings...".
pub const OPEN_SETTINGS_EVENT: &str = "desktop-menu:settings";

/// The app's name as users see it (the bundle name cannot contain the slash).
const APP_NAME: &str = "re/notes";

/// Upper bound for one menu text from the page.
const MAX_TEXT_CHARS: usize = 100;

/// English texts until the page sends those of its language. The keys are the
/// `desktop.menu.*` keys of the notes translations, and the texts equal the
/// English ones there (`desktop-menu.spec.ts` checks both).
const DEFAULT_TEXTS: &[(&str, &str)] = &[
    ("about", "About re/notes"),
    ("settings", "Settings…"),
    ("services", "Services"),
    ("hide", "Hide re/notes"),
    ("hide_others", "Hide Others"),
    ("show_all", "Show All"),
    ("quit", "Quit re/notes"),
    ("edit", "Edit"),
    ("undo", "Undo"),
    ("redo", "Redo"),
    ("cut", "Cut"),
    ("copy", "Copy"),
    ("paste", "Paste"),
    ("select_all", "Select All"),
    ("view", "View"),
    ("window", "Window"),
    ("minimize", "Minimize"),
    ("zoom", "Zoom"),
    ("close_window", "Close Window"),
];

fn default_text(key: &str) -> &'static str {
    DEFAULT_TEXTS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, text)| *text)
        .unwrap_or("")
}

/// A text from the page that may go into the menu: trimmed, not empty, not
/// too long and without control characters. Anything else keeps the current
/// text.
fn usable_text(text: &str) -> Option<&str> {
    let text = text.trim();
    let ok = !text.is_empty()
        && text.chars().count() <= MAX_TEXT_CHARS
        && !text.chars().any(char::is_control);
    ok.then_some(text)
}

/// The menu items whose text the page translates, by translation key.
pub struct MenuTexts<R: Runtime> {
    items: Vec<(&'static str, MenuItemKind<R>)>,
}

impl<R: Runtime> MenuTexts<R> {
    fn track(&mut self, key: &'static str, item: &dyn IsMenuItem<R>) {
        self.items.push((key, item.kind()));
    }

    /// Set the texts the page sent. Unknown keys and unusable texts are
    /// skipped; an item without a text keeps the one it has.
    fn apply(&self, texts: &HashMap<String, String>) -> tauri::Result<()> {
        for (key, item) in &self.items {
            let Some(text) = texts.get(*key).and_then(|t| usable_text(t)) else {
                continue;
            };
            match item {
                MenuItemKind::MenuItem(i) => i.set_text(text)?,
                MenuItemKind::Submenu(i) => i.set_text(text)?,
                MenuItemKind::Predefined(i) => i.set_text(text)?,
                MenuItemKind::Check(i) => i.set_text(text)?,
                MenuItemKind::Icon(i) => i.set_text(text)?,
            }
        }
        Ok(())
    }
}

/// Build the menu, plus the handles to translate it later.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<(Menu<R>, MenuTexts<R>)> {
    let mut texts = MenuTexts { items: Vec::new() };
    let info = app_info::read(app);
    // The About panel reads "Version 0.1.0 (1)": the version and the build.
    let about_metadata = AboutMetadata {
        name: Some(APP_NAME.into()),
        version: Some(info.version),
        short_version: Some(info.build),
        ..Default::default()
    };

    let about = PredefinedMenuItem::about(app, Some(default_text("about")), Some(about_metadata))?;
    let settings = MenuItem::with_id(
        app,
        SETTINGS_ITEM_ID,
        default_text("settings"),
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let services = PredefinedMenuItem::services(app, Some(default_text("services")))?;
    let hide = PredefinedMenuItem::hide(app, Some(default_text("hide")))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some(default_text("hide_others")))?;
    let show_all = PredefinedMenuItem::show_all(app, Some(default_text("show_all")))?;
    let quit = PredefinedMenuItem::quit(app, Some(default_text("quit")))?;
    // macOS always titles the first menu with the bundle name, whatever the
    // text here.
    let app_menu = Submenu::with_items(
        app,
        APP_NAME,
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &services,
            &PredefinedMenuItem::separator(app)?,
            &hide,
            &hide_others,
            &show_all,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    for (key, item) in [
        ("about", &about as &dyn IsMenuItem<R>),
        ("settings", &settings),
        ("services", &services),
        ("hide", &hide),
        ("hide_others", &hide_others),
        ("show_all", &show_all),
        ("quit", &quit),
    ] {
        texts.track(key, item);
    }

    let undo = PredefinedMenuItem::undo(app, Some(default_text("undo")))?;
    let redo = PredefinedMenuItem::redo(app, Some(default_text("redo")))?;
    let cut = PredefinedMenuItem::cut(app, Some(default_text("cut")))?;
    let copy = PredefinedMenuItem::copy(app, Some(default_text("copy")))?;
    let paste = PredefinedMenuItem::paste(app, Some(default_text("paste")))?;
    let select_all = PredefinedMenuItem::select_all(app, Some(default_text("select_all")))?;
    let edit_menu = Submenu::with_items(
        app,
        default_text("edit"),
        true,
        &[
            &undo,
            &redo,
            &PredefinedMenuItem::separator(app)?,
            &cut,
            &copy,
            &paste,
            &select_all,
        ],
    )?;
    for (key, item) in [
        ("edit", &edit_menu as &dyn IsMenuItem<R>),
        ("undo", &undo),
        ("redo", &redo),
        ("cut", &cut),
        ("copy", &copy),
        ("paste", &paste),
        ("select_all", &select_all),
    ] {
        texts.track(key, item);
    }

    // AppKit names the full screen item itself ("Enter Full Screen" / "Exit
    // Full Screen", in the system language), so it has no translation key.
    let view_menu = Submenu::with_items(
        app,
        default_text("view"),
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    texts.track("view", &view_menu);

    let minimize = PredefinedMenuItem::minimize(app, Some(default_text("minimize")))?;
    let zoom = PredefinedMenuItem::maximize(app, Some(default_text("zoom")))?;
    let close_window = PredefinedMenuItem::close_window(app, Some(default_text("close_window")))?;
    let window_menu = Submenu::with_items(
        app,
        default_text("window"),
        true,
        &[
            &minimize,
            &zoom,
            &PredefinedMenuItem::separator(app)?,
            &close_window,
        ],
    )?;
    // macOS appends the window list and "Bring All to Front" to this menu.
    window_menu.set_as_windows_menu_for_nsapp()?;
    for (key, item) in [
        ("window", &window_menu as &dyn IsMenuItem<R>),
        ("minimize", &minimize),
        ("zoom", &zoom),
        ("close_window", &close_window),
    ] {
        texts.track(key, item);
    }

    let menu = Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])?;
    Ok((menu, texts))
}

/// Translate the menu into the app's language. `texts` maps the keys of
/// `desktop.menu.*` to their texts; unknown keys and unusable texts are
/// ignored. No-op where the shell has no menu (Windows, Linux).
#[tauri::command]
pub fn desktop_menu_localize(app: AppHandle, texts: HashMap<String, String>) -> Result<(), String> {
    match app.try_state::<MenuTexts<Wry>>() {
        Some(menu) => menu.apply(&texts).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_texts_have_unique_keys() {
        let mut keys: Vec<&str> = DEFAULT_TEXTS.iter().map(|(k, _)| *k).collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), DEFAULT_TEXTS.len());
    }

    #[test]
    fn every_default_text_is_usable() {
        for (key, text) in DEFAULT_TEXTS {
            assert_eq!(usable_text(text), Some(*text), "default text of {key}");
        }
    }

    #[test]
    fn unknown_key_has_no_default() {
        assert_eq!(default_text("settings"), "Settings…");
        assert_eq!(default_text("no_such_item"), "");
    }

    #[test]
    fn page_text_is_trimmed() {
        assert_eq!(usable_text("  Kopiuj  "), Some("Kopiuj"));
        assert_eq!(usable_text("Zakończ re/notes"), Some("Zakończ re/notes"));
        assert_eq!(usable_text("إنهاء re/notes"), Some("إنهاء re/notes"));
    }

    #[test]
    fn empty_long_or_control_text_is_rejected() {
        assert_eq!(usable_text(""), None);
        assert_eq!(usable_text("   "), None);
        assert_eq!(usable_text(&"a".repeat(MAX_TEXT_CHARS + 1)), None);
        assert_eq!(
            usable_text(&"ä".repeat(MAX_TEXT_CHARS)),
            Some(&*"ä".repeat(MAX_TEXT_CHARS))
        );
        assert_eq!(usable_text("Copy\nPaste"), None);
        assert_eq!(usable_text("Copy\u{0}"), None);
    }
}
