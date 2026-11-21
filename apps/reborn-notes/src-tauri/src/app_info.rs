//! Version of the desktop app, read by the page for Settings ("About") and to
//! pick the What's new entries of this platform.
//!
//! Like the mobile shells, the desktop app has its own version, independent of
//! the monorepo version the bundled web build carries (`__APP_VERSION__`):
//! `version` and `bundle > macOS > bundleVersion` in `tauri.conf.json`, which
//! the bundler also writes to `CFBundleShortVersionString` / `CFBundleVersion`.
//! The page shows both, the same way as on mobile (guideline 38).

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

/// The app's version and build, from the config compiled into the binary.
pub fn read<R: Runtime>(app: &AppHandle<R>) -> AppInfo {
    let version = app.package_info().version.to_string();
    let configured = configured_build(app);
    AppInfo {
        build: build_number(&version, configured.as_deref()),
        version,
        platform: std::env::consts::OS,
    }
}

#[cfg(target_os = "macos")]
fn configured_build<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.config().bundle.macos.bundle_version.clone()
}

/// Windows and Linux have no separate build number in the config (D5 decides
/// the Windows one), so the version stands in for it.
#[cfg(not(target_os = "macos"))]
fn configured_build<R: Runtime>(_app: &AppHandle<R>) -> Option<String> {
    None
}

/// Version info for the page. Never fails: everything comes from the config
/// compiled into the binary.
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
