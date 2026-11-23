//! Links that leave the app open in the default browser or mail app.
//!
//! A WKWebView without a UI delegate answer ignores `target="_blank"` and
//! `window.open`: wry only creates a new window when the app supplies a new
//! window handler, and returns nothing otherwise (`createWebViewWith...` in
//! wry's UI delegate). Before D4 every external link of the shell did
//! nothing: links in notes, the policy and help links in Settings, the store
//! link of the update gate. A plain link without a target would instead have
//! replaced the app in its only window with a remote page.
//!
//! Both cases end here, on the Rust side, so the page needs no permission for
//! it and keeps using ordinary links:
//! - a new window request (`target="_blank"`, `window.open`) never creates a
//!   window; an http(s), mailto or macappstore URL opens in the system's
//!   default app;
//! - a navigation of the window stays on the app's own origin (and on blank
//!   or generated frames); an external URL opens in the default app instead,
//!   anything else is refused.

use tauri::Url;

/// What to do with a URL the webview wants to go to.
#[derive(Debug, PartialEq, Eq)]
pub enum Destination {
    /// The bundled app itself, a blank frame or generated content: stays in
    /// the webview.
    App,
    /// A web page, an email address or the Mac App Store: handed to the
    /// default app.
    External,
    /// Anything else (other schemes, `file:`, custom handlers): refused.
    Refused,
}

pub fn destination(url: &Url) -> Destination {
    match url.scheme() {
        // The bundled app on macOS (`tauri://localhost`), the blank frame
        // html2canvas renders into, blob and data URLs the page generates.
        "tauri" | "about" | "blob" | "data" => Destination::App,
        // The bundled app on Windows is served from this host (D5).
        "http" | "https" if url.host_str() == Some("tauri.localhost") => Destination::App,
        // `macappstore:` opens the store app on the listing (the update gate's
        // link can use it instead of the https page).
        "http" | "https" | "mailto" | "macappstore" => Destination::External,
        _ => Destination::Refused,
    }
}

/// Navigation policy of the main window: `true` keeps the navigation.
pub fn on_navigation(url: &Url) -> bool {
    match destination(url) {
        Destination::App => true,
        Destination::External => {
            open_externally(url);
            false
        }
        Destination::Refused => false,
    }
}

/// New window requests: opened outside the app when external, never as a
/// window of the app.
pub fn on_new_window(url: &Url) {
    if destination(url) == Destination::External {
        open_externally(url);
    }
}

#[cfg(target_os = "macos")]
fn open_externally(url: &Url) {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};

    let Some(ns_url) = NSURL::URLWithString(&NSString::from_str(url.as_str())) else {
        return;
    };
    // Best effort: a failure leaves the click without effect, like before.
    let _ = NSWorkspace::sharedWorkspace().openURL(&ns_url);
}

/// Windows opens links in D5 (ShellExecute); until then nothing happens.
#[cfg(not(target_os = "macos"))]
fn open_externally(_url: &Url) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn of(url: &str) -> Destination {
        destination(&url.parse().expect("url"))
    }

    #[test]
    fn the_app_and_generated_frames_stay_in_the_webview() {
        for url in [
            "tauri://localhost/",
            "tauri://localhost/settings",
            "http://tauri.localhost/notes",
            "about:blank",
            "blob:tauri://localhost/5b1c",
            "data:text/html,x",
        ] {
            assert_eq!(of(url), Destination::App, "{url}");
        }
    }

    #[test]
    fn web_pages_and_mail_open_outside() {
        for url in [
            "https://reapps.eu/privacy",
            "http://example.com/",
            "https://apps.apple.com/app/id123",
            "mailto:hello@example.com",
            "http://localhost/notes",
            "macappstore://apps.apple.com/app/id123",
        ] {
            assert_eq!(of(url), Destination::External, "{url}");
        }
    }

    #[test]
    fn other_schemes_are_refused() {
        for url in [
            "file:///etc/hosts",
            "javascript:alert(1)",
            "x-apple.systempreferences:com.apple.preference",
            "ftp://example.com/",
        ] {
            assert_eq!(of(url), Destination::Refused, "{url}");
        }
    }
}
