//! Version of the desktop app, read by the page for Settings ("About") and to
//! pick the What's new entries of this platform.
//!
//! Like the mobile shells, the desktop app has its own version, independent of
//! the monorepo version the bundled web build carries (`__APP_VERSION__`):
//! `version` and `bundle > macOS > bundleVersion` in `tauri.conf.json`, which
//! the bundler also writes to `CFBundleShortVersionString` / `CFBundleVersion`.
//! The page shows both, the same way as on mobile (guideline 38).
//!
//! The build number is read back from Info.plist, not from `app.config()`:
//! the config Tauri compiles into the binary drops the `bundle > macOS`
//! section (tauri-utils sets it to the default), so `bundleVersion` is always
//! empty there. Info.plist holds it both in the `.app` bundle and in a bare
//! binary (tauri-codegen embeds the plist).

use serde::Serialize;
use tauri::{AppHandle, Runtime};

/// Version, build number and operating system of the running shell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Marketing version, e.g. "0.1.0".
    pub version: String,
    /// Build number, e.g. "1". Falls back to the version when none is set.
    pub build: String,
    /// `std::env::consts::OS`: "macos", "windows" or "linux" - the same names
    /// the release notes use for their platform badges.
    pub platform: &'static str,
}

/// Build number for a version: the configured one, or the version itself
/// (what the bundler writes to `CFBundleVersion` when none is set).
fn build_number(version: &str, configured: Option<&str>) -> String {
    match configured.map(str::trim) {
        Some(build) if !build.is_empty() => build.to_owned(),
        _ => version.to_owned(),
    }
}

/// The app's version (compiled-in config) and build (Info.plist).
pub fn read<R: Runtime>(app: &AppHandle<R>) -> AppInfo {
    let version = app.package_info().version.to_string();
    let configured = configured_build();
    AppInfo {
        build: build_number(&version, configured.as_deref()),
        version,
        platform: std::env::consts::OS,
    }
}

/// `CFBundleVersion` of the running app.
#[cfg(target_os = "macos")]
fn configured_build() -> Option<String> {
    use objc2_foundation::{ns_string, NSBundle, NSString};
    let value = NSBundle::mainBundle().objectForInfoDictionaryKey(ns_string!("CFBundleVersion"))?;
    let text = value.downcast::<NSString>().ok()?;
    Some(text.to_string())
}

/// Windows and Linux have no separate build number yet (D5 decides the
/// Windows one), so the version stands in for it.
#[cfg(not(target_os = "macos"))]
fn configured_build() -> Option<String> {
    None
}

/// Version info for the page. Never fails: everything comes from the binary
/// itself (its config and Info.plist).
#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    read(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_build_wins() {
        assert_eq!(build_number("0.1.0", Some("7")), "7");
    }

    #[test]
    fn missing_or_blank_build_falls_back_to_the_version() {
        assert_eq!(build_number("0.1.0", None), "0.1.0");
        assert_eq!(build_number("0.1.0", Some("")), "0.1.0");
        assert_eq!(build_number("0.1.0", Some("  ")), "0.1.0");
    }

    #[test]
    fn serializes_in_camel_case_for_the_page() {
        let info = AppInfo {
            version: "0.1.0".into(),
            build: "1".into(),
            platform: "macos",
        };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({ "version": "0.1.0", "build": "1", "platform": "macos" })
        );
    }
}
