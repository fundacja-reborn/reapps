//! Overdue-backup reminder for the desktop shell: the counterpart of
//! `@capacitor/local-notifications` on the phones.
//!
//! The automated backup runs only while the app is open (`src/lib/services/
//! auto-backup/`), so a user who stops opening the app silently stops getting
//! backups. The page plans up to two "open the app" reminders after every
//! backup run (`reminder.ts`); this module hands them to the system, which
//! delivers them even when the app is not running. Clicking one opens the app.
//!
//! macOS: `UNUserNotificationCenter` with time-interval triggers. The center
//! needs a real app bundle: in a bare binary (`cargo tauri dev`) it aborts the
//! process, so there every command answers `unsupported` and the page hides the
//! promise of a reminder. Windows (D5) and Linux answer the same until then.
//!
//! The surface is deliberately narrow (D2 principle): the identifiers are the
//! shell's own, so the page can only replace or cancel these two reminders,
//! never post or remove any other notification. Title and body are bounded
//! plain text (the page sends static, localized copy - never note data).
//!
//! When the user turned the notifications off, the page can open this app's
//! page in System Settings > Notifications (a fixed address built from the
//! app's own bundle identifier; the page passes nothing).

use serde::Serialize;

/// The shell's own identifiers: rescheduling replaces, never accumulates.
const IDENTIFIERS: [&str; 2] = [
    "eu.reapps.notes.backup-reminder.1",
    "eu.reapps.notes.backup-reminder.2",
];

/// Longest title or body accepted from the page.
const MAX_TEXT_CHARS: usize = 200;

/// The furthest a reminder may be planned (the page plans days, not years).
const MAX_DELAY_SECS: f64 = 400.0 * 24.0 * 60.0 * 60.0;

/// Debug builds only: fire the reminders this many seconds apart from now,
/// whatever the page planned, so a smoke test does not wait for hours.
#[cfg(debug_assertions)]
const TEST_DELAY_ENV: &str = "REBORN_BACKUP_REMINDER_TEST_SECS";

/// The system's notification permission, in the words of the Capacitor
/// plugin's `display` field (`prompt` = not asked yet), plus `unsupported`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Permission {
    Granted,
    Denied,
    Prompt,
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct ReminderError {
    code: &'static str,
}

const INVALID_REQUEST: ReminderError = ReminderError {
    code: "invalidRequest",
};
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const SCHEDULE_FAILED: ReminderError = ReminderError {
    code: "scheduleFailed",
};

/// One reminder handed to the system: its identifier and the delay from now.
#[derive(Clone, Debug, PartialEq)]
struct Planned {
    identifier: &'static str,
    delay_secs: f64,
}

/// A title or body from the page: trimmed, not empty, bounded, no control
/// characters.
fn usable_text(text: &str) -> Option<&str> {
    let text = text.trim();
    let ok = !text.is_empty()
        && text.chars().count() <= MAX_TEXT_CHARS
        && !text.chars().any(char::is_control);
    ok.then_some(text)
}

/// Turn the page's epoch-millisecond times into delays for the system.
///
/// At most two, each in the future and within [`MAX_DELAY_SECS`]. With
/// `test_secs` (debug builds) the reminders fire that many seconds apart from
/// now instead.
fn plan(at_ms: &[f64], now_ms: f64, test_secs: Option<f64>) -> Result<Vec<Planned>, ReminderError> {
    if at_ms.len() > IDENTIFIERS.len() {
        return Err(INVALID_REQUEST);
    }
    at_ms
        .iter()
        .zip(IDENTIFIERS)
        .enumerate()
        .map(|(index, (&at, identifier))| {
            if !at.is_finite() {
                return Err(INVALID_REQUEST);
            }
            let delay_secs = match test_secs {
                Some(step) => step * (index as f64 + 1.0),
                None => (at - now_ms) / 1000.0,
            };
            // The system rejects a zero interval with an exception.
            if !(1.0..=MAX_DELAY_SECS).contains(&delay_secs) {
                return Err(INVALID_REQUEST);
            }
            Ok(Planned {
                identifier,
                delay_secs,
            })
        })
        .collect()
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[cfg(debug_assertions)]
fn test_delay() -> Option<f64> {
    std::env::var(TEST_DELAY_ENV)
        .ok()?
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|secs| secs.is_finite() && *secs >= 1.0)
}

#[cfg(not(debug_assertions))]
fn test_delay() -> Option<f64> {
    None
}

/// The current permission. Never fails.
#[tauri::command]
pub async fn backup_reminder_status() -> Permission {
    tauri::async_runtime::spawn_blocking(platform::status)
        .await
        .unwrap_or(Permission::Unsupported)
}

/// Ask for the permission when it was never asked (shows the system prompt),
/// then report it. Answers right away when the user already decided.
#[tauri::command]
pub async fn backup_reminder_request_permission() -> Permission {
    tauri::async_runtime::spawn_blocking(platform::request_permission)
        .await
        .unwrap_or(Permission::Unsupported)
}

/// Replace the pending reminders with these: `at` in epoch milliseconds (one
/// or two), the same title and body for each. Without the permission nothing
/// is planned and no error is raised - the reminders are best effort.
#[tauri::command]
pub async fn backup_reminder_schedule(
    at: Vec<f64>,
    title: String,
    body: String,
) -> Result<(), ReminderError> {
    let planned = plan(&at, now_ms(), test_delay())?;
    let title = usable_text(&title).ok_or(INVALID_REQUEST)?.to_owned();
    let body = usable_text(&body).ok_or(INVALID_REQUEST)?.to_owned();
    tauri::async_runtime::spawn_blocking(move || platform::schedule(&planned, &title, &body))
        .await
        .map_err(|_| INVALID_REQUEST)?
}

/// Drop the pending reminders (backup turned off, logout). Never fails.
#[tauri::command]
pub async fn backup_reminder_cancel() {
    let _ = tauri::async_runtime::spawn_blocking(platform::cancel).await;
}

/// Open this app's page in System Settings > Notifications, where the user
/// turns the notifications back on. Answers whether it was opened (false
/// outside an app bundle and where the shell has no notifications).
#[tauri::command]
pub fn backup_reminder_open_settings() -> bool {
    platform::open_settings()
}

/// System Settings > Notifications, on the page of the app with this bundle
/// identifier (macOS 13 and later; the app needs 14).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn notification_settings_url(bundle_id: &str) -> Option<String> {
    let valid = !bundle_id.is_empty()
        && bundle_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    valid.then(|| {
        format!(
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id={bundle_id}"
        )
    })
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ptr::NonNull;
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSArray, NSBundle, NSError, NSString, NSURL};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotificationContent, UNNotificationRequest, UNNotificationSettings,
        UNNotificationTrigger, UNTimeIntervalNotificationTrigger, UNUserNotificationCenter,
    };

    use super::{
        notification_settings_url, Permission, Planned, ReminderError, IDENTIFIERS, SCHEDULE_FAILED,
    };

    /// The notification center, or `None` outside an app bundle.
    ///
    /// `currentNotificationCenter` raises an Objective-C exception (and takes
    /// the process down) when the process has no bundle record, which is the
    /// case for the bare binary of `cargo tauri dev`, even though it carries
    /// an embedded Info.plist with a bundle identifier.
    fn center() -> Option<Retained<UNUserNotificationCenter>> {
        let bundle = NSBundle::mainBundle();
        let in_app_bundle = bundle.bundlePath().to_string().ends_with(".app");
        (in_app_bundle && bundle.bundleIdentifier().is_some())
            .then(UNUserNotificationCenter::currentNotificationCenter)
    }

    fn permission(status: UNAuthorizationStatus) -> Permission {
        match status {
            UNAuthorizationStatus::NotDetermined => Permission::Prompt,
            UNAuthorizationStatus::Denied => Permission::Denied,
            // Provisional (quiet delivery) and ephemeral still deliver.
            _ => Permission::Granted,
        }
    }

    fn status_of(center: &UNUserNotificationCenter) -> Permission {
        let (sender, receiver) = mpsc::channel::<UNAuthorizationStatus>();
        // Called once, on a private queue.
        let handler = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: the framework passes a valid settings object.
            let status = unsafe { settings.as_ref() }.authorizationStatus();
            let _ = sender.send(status);
        });
        center.getNotificationSettingsWithCompletionHandler(&handler);
        // The framework keeps its own reference; a block released without a
        // call closes the channel and ends the wait below.
        drop(handler);
        receiver
            .recv()
            .map(permission)
            .unwrap_or(Permission::Unsupported)
    }

    pub(super) fn status() -> Permission {
        center().map_or(Permission::Unsupported, |center| status_of(&center))
    }

    pub(super) fn request_permission() -> Permission {
        let Some(center) = center() else {
            return Permission::Unsupported;
        };
        let current = status_of(&center);
        if current != Permission::Prompt {
            return current;
        }
        let (sender, receiver) = mpsc::channel::<()>();
        // Called once the user answers the prompt (or the system declines to
        // show it); the outcome is read back from the settings below.
        let handler = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
            let _ = sender.send(());
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &handler,
        );
        drop(handler);
        let _ = receiver.recv();
        status_of(&center)
    }

    fn remove_pending(center: &UNUserNotificationCenter) {
        let identifiers: Vec<Retained<NSString>> = IDENTIFIERS
            .iter()
            .map(|id| NSString::from_str(id))
            .collect();
        center.removePendingNotificationRequestsWithIdentifiers(&NSArray::from_retained_slice(
            &identifiers,
        ));
    }

    pub(super) fn schedule(
        planned: &[Planned],
        title: &str,
        body: &str,
    ) -> Result<(), ReminderError> {
        let Some(center) = center() else {
            // Same as a missing permission: nothing to plan, nothing to report.
            return Ok(());
        };
        remove_pending(&center);
        if planned.is_empty() || status_of(&center) != Permission::Granted {
            return Ok(());
        }
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        let content: &UNNotificationContent = &content;

        for reminder in planned {
            let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(
                reminder.delay_secs,
                false,
            );
            let trigger: &UNNotificationTrigger = &trigger;
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str(reminder.identifier),
                content,
                Some(trigger),
            );
            let (sender, receiver) = mpsc::channel::<bool>();
            let handler = RcBlock::new(move |error: *mut NSError| {
                let _ = sender.send(error.is_null());
            });
            center.addNotificationRequest_withCompletionHandler(&request, Some(&handler));
            drop(handler);
            if receiver.recv() != Ok(true) {
                // Leave no half-planned pair behind.
                remove_pending(&center);
                return Err(SCHEDULE_FAILED);
            }
        }
        Ok(())
    }

    pub(super) fn cancel() {
        if let Some(center) = center() {
            remove_pending(&center);
        }
    }

    pub(super) fn open_settings() -> bool {
        // Same condition as the notification center: a bare binary has no
        // page in System Settings.
        if center().is_none() {
            return false;
        }
        let Some(identifier) = NSBundle::mainBundle().bundleIdentifier() else {
            return false;
        };
        let Some(url) = notification_settings_url(&identifier.to_string())
            .and_then(|url| NSURL::URLWithString(&NSString::from_str(&url)))
        else {
            return false;
        };
        NSWorkspace::sharedWorkspace().openURL(&url)
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{Permission, Planned, ReminderError};

    pub(super) fn status() -> Permission {
        Permission::Unsupported
    }

    pub(super) fn request_permission() -> Permission {
        Permission::Unsupported
    }

    pub(super) fn schedule(
        _planned: &[Planned],
        _title: &str,
        _body: &str,
    ) -> Result<(), ReminderError> {
        // Nothing to plan without a notification center (Windows in D5).
        Ok(())
    }

    pub(super) fn cancel() {}

    pub(super) fn open_settings() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: f64 = 1_800_000_000_000.0;
    const HOUR_MS: f64 = 3_600_000.0;

    #[test]
    fn plans_delays_from_now_with_the_shell_identifiers() {
        let planned = plan(&[NOW + HOUR_MS, NOW + 3.0 * HOUR_MS], NOW, None).unwrap();
        assert_eq!(
            planned,
            vec![
                Planned {
                    identifier: IDENTIFIERS[0],
                    delay_secs: 3600.0
                },
                Planned {
                    identifier: IDENTIFIERS[1],
                    delay_secs: 10_800.0
                },
            ]
        );
    }

    #[test]
    fn empty_plan_is_valid() {
        assert_eq!(plan(&[], NOW, None), Ok(vec![]));
    }

    #[test]
    fn rejects_more_than_two_past_far_or_invalid_times() {
        let hour = NOW + HOUR_MS;
        assert_eq!(plan(&[hour, hour, hour], NOW, None), Err(INVALID_REQUEST));
        assert_eq!(plan(&[NOW - 1.0], NOW, None), Err(INVALID_REQUEST));
        assert_eq!(plan(&[NOW + 500.0], NOW, None), Err(INVALID_REQUEST));
        assert_eq!(
            plan(&[NOW + (MAX_DELAY_SECS + 1.0) * 1000.0], NOW, None),
            Err(INVALID_REQUEST)
        );
        assert_eq!(plan(&[f64::NAN], NOW, None), Err(INVALID_REQUEST));
        assert_eq!(plan(&[f64::INFINITY], NOW, None), Err(INVALID_REQUEST));
    }

    #[test]
    fn test_delay_spaces_the_reminders_from_now() {
        let far = NOW + 100.0 * HOUR_MS;
        let planned = plan(&[far, far + HOUR_MS], NOW, Some(15.0)).unwrap();
        let delays: Vec<f64> = planned.iter().map(|p| p.delay_secs).collect();
        assert_eq!(delays, vec![15.0, 30.0]);
    }

    #[test]
    fn texts_are_trimmed_bounded_and_single_line() {
        assert_eq!(
            usable_text("  Automatic backup is due "),
            Some("Automatic backup is due")
        );
        assert_eq!(
            usable_text("حان موعد النسخ الاحتياطي"),
            Some("حان موعد النسخ الاحتياطي")
        );
        assert_eq!(usable_text(" "), None);
        assert_eq!(usable_text(&"x".repeat(MAX_TEXT_CHARS + 1)), None);
        assert_eq!(usable_text("line\nbreak"), None);
    }

    #[test]
    fn permission_and_errors_serialize_for_the_page() {
        assert_eq!(serde_json::to_value(Permission::Prompt).unwrap(), "prompt");
        assert_eq!(
            serde_json::to_value(Permission::Unsupported).unwrap(),
            "unsupported"
        );
        assert_eq!(
            serde_json::to_value(INVALID_REQUEST).unwrap(),
            serde_json::json!({ "code": "invalidRequest" })
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_binary_has_no_notification_center() {
        // The test binary is not an app bundle: the commands must degrade to
        // "unsupported" instead of aborting the process.
        assert_eq!(platform::status(), Permission::Unsupported);
        assert_eq!(platform::request_permission(), Permission::Unsupported);
        assert_eq!(platform::schedule(&[], "t", "b"), Ok(()));
        platform::cancel();
        assert!(!platform::open_settings());
    }

    #[test]
    fn settings_open_on_the_page_of_this_app() {
        assert_eq!(
            notification_settings_url("eu.reapps.notes").as_deref(),
            Some("x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=eu.reapps.notes")
        );
        assert_eq!(
            notification_settings_url("eu.reapps.notes.dev").as_deref(),
            Some("x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=eu.reapps.notes.dev")
        );
    }

    #[test]
    fn an_unexpected_bundle_identifier_opens_nothing() {
        assert_eq!(notification_settings_url(""), None);
        assert_eq!(notification_settings_url("eu.reapps&x=1"), None);
        assert_eq!(notification_settings_url("eu reapps"), None);
    }
}
