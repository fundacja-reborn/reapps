//! App Lock for the desktop shell: the system authentication prompt, the
//! desktop counterpart of the Capacitor biometric plugin.
//!
//! Same model as on the phones (decision 2026-11-21): the system decides how
//! the user proves it is them. On macOS that is LocalAuthentication with the
//! `deviceOwnerAuthentication` policy - Touch ID (or a paired Apple Watch)
//! when available, the macOS account password otherwise. The prompt only gates
//! reading the master key back into memory; it is a UX lock, not encryption
//! (guideline 66, option B).
//!
//! Windows (Windows Hello) comes with the Windows phase. Until then every
//! other platform answers "not available" instead of failing, so the settings
//! screen degrades the same way it does on a phone without biometrics.
//!
//! Errors carry only a `code` from the plugin's `BiometryErrorType` set, the
//! vocabulary `app-lock.service.ts` and the lock screen already understand.

use serde::Serialize;

/// Longest prompt text accepted from the page. The app sends one short,
/// localized sentence fragment; the cap only bounds what a compromised page
/// could put into a system dialog.
const MAX_REASON_CHARS: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLockStatus {
    /// Biometry is present and enrolled (Touch ID).
    is_available: bool,
    /// The system can authenticate the user at all (account password set).
    device_is_secure: bool,
    /// `touchId` or `none`, the labels `BiometryKind` uses on the JS side.
    kind: &'static str,
}

impl AppLockStatus {
    const UNAVAILABLE: Self = Self {
        is_available: false,
        device_is_secure: false,
        kind: "none",
    };

    fn new(device_is_secure: bool, touch_id: bool) -> Self {
        Self {
            is_available: touch_id,
            device_is_secure,
            kind: if touch_id { "touchId" } else { "none" },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct AppLockError {
    code: &'static str,
}

const AUTHENTICATION_FAILED: AppLockError = AppLockError {
    code: "authenticationFailed",
};
const INVALID_REASON: AppLockError = AppLockError {
    code: "invalidContext",
};
#[cfg(not(target_os = "macos"))]
const NOT_AVAILABLE: AppLockError = AppLockError {
    code: "biometryNotAvailable",
};

/// Pick the prompt text for this platform and check it.
///
/// macOS builds the sentence itself: "<app> is trying to <reason>." in the
/// system language, so it gets its own fragment (`macos_reason`). Other
/// platforms show the reason on its own line. An empty reason must never reach
/// LocalAuthentication: it raises an Objective-C exception for it.
fn prompt_reason(reason: String, macos_reason: Option<String>) -> Result<String, AppLockError> {
    let chosen = if cfg!(target_os = "macos") {
        macos_reason
            .filter(|text| !text.trim().is_empty())
            .unwrap_or(reason)
    } else {
        reason
    };
    let chosen = chosen.trim();
    if chosen.is_empty() || chosen.chars().count() > MAX_REASON_CHARS {
        return Err(INVALID_REASON);
    }
    Ok(chosen.to_owned())
}

/// Whether the system can show the unlock prompt, and with which biometry.
#[tauri::command]
pub async fn app_lock_status() -> AppLockStatus {
    tauri::async_runtime::spawn_blocking(platform::status)
        .await
        .unwrap_or(AppLockStatus::UNAVAILABLE)
}

/// Show the system prompt and wait for the user. Resolves on success, rejects
/// with `{ code }` otherwise (`userCancel` when the user dismissed it).
///
/// The prompt can stay open for as long as the user needs, so it waits on a
/// blocking thread rather than on the async runtime.
#[tauri::command]
pub async fn app_lock_authenticate(
    reason: String,
    macos_reason: Option<String>,
) -> Result<(), AppLockError> {
    let reason = prompt_reason(reason, macos_reason)?;
    tauri::async_runtime::spawn_blocking(move || platform::authenticate(&reason))
        .await
        .map_err(|_| AUTHENTICATION_FAILED)?
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSInteger, NSString};
    use objc2_local_authentication::{LABiometryType, LAContext, LAError, LAPolicy};

    use super::{AppLockError, AppLockStatus, AUTHENTICATION_FAILED};

    pub(super) fn status() -> AppLockStatus {
        // SAFETY: a fresh context, used on this thread only. The preflight
        // calls show no UI; `biometryType` is valid after the first of them.
        let (device_is_secure, touch_id) = unsafe {
            let context = LAContext::new();
            let device_is_secure = context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication)
                .is_ok();
            let biometry = context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .is_ok();
            (
                device_is_secure,
                biometry && context.biometryType() == LABiometryType::TouchID,
            )
        };
        AppLockStatus::new(device_is_secure, touch_id)
    }

    pub(super) fn authenticate(reason: &str) -> Result<(), AppLockError> {
        let (sender, receiver) = mpsc::channel::<Result<(), NSInteger>>();
        // LocalAuthentication calls the reply on a private queue, once.
        let reply = RcBlock::new(move |success: Bool, error: *mut NSError| {
            let outcome = if success.as_bool() {
                Ok(())
            } else {
                // SAFETY: on failure the framework passes a valid NSError (or
                // null, which falls back to a generic failure).
                let error = unsafe { error.as_ref() };
                Err(error.map_or(LAError::AuthenticationFailed.0, |e| e.code()))
            };
            let _ = sender.send(outcome);
        });
        let reason = NSString::from_str(reason);
        // SAFETY: the reason is non-empty (checked by the caller), the reply
        // block only moves its result into a channel, and `context` outlives
        // the reply because this thread waits for it below.
        let context = unsafe { LAContext::new() };
        unsafe {
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthentication,
                &reason,
                &reply,
            );
        }
        // The framework keeps its own reference to the block. Dropping ours
        // means a block released without a reply closes the channel, so the
        // wait below ends with an error instead of blocking forever.
        drop(reply);
        let outcome = receiver.recv();
        drop(context);
        match outcome {
            Ok(Ok(())) => Ok(()),
            Ok(Err(code)) => Err(AppLockError {
                code: error_code(LAError(code)),
            }),
            Err(_) => Err(AUTHENTICATION_FAILED),
        }
    }

    /// Map a LocalAuthentication error to the plugin's `BiometryErrorType`.
    pub(super) fn error_code(error: LAError) -> &'static str {
        match error {
            LAError::UserCancel => "userCancel",
            LAError::SystemCancel => "systemCancel",
            LAError::AppCancel => "appCancel",
            LAError::UserFallback => "userFallback",
            LAError::PasscodeNotSet => "passcodeNotSet",
            LAError::BiometryNotEnrolled => "biometryNotEnrolled",
            LAError::BiometryLockout => "biometryLockout",
            // Touch ID on a detached Magic Keyboard counts as "not available".
            LAError::BiometryNotAvailable
            | LAError::BiometryNotPaired
            | LAError::BiometryDisconnected => "biometryNotAvailable",
            LAError::InvalidContext => "invalidContext",
            LAError::NotInteractive => "notInteractive",
            _ => "authenticationFailed",
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{AppLockError, AppLockStatus, NOT_AVAILABLE};

    pub(super) fn status() -> AppLockStatus {
        AppLockStatus::UNAVAILABLE
    }

    pub(super) fn authenticate(_reason: &str) -> Result<(), AppLockError> {
        Err(NOT_AVAILABLE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_labels_touch_id_only_when_enrolled() {
        assert_eq!(
            serde_json::to_value(AppLockStatus::new(true, true)).unwrap(),
            serde_json::json!({ "isAvailable": true, "deviceIsSecure": true, "kind": "touchId" })
        );
        assert_eq!(
            serde_json::to_value(AppLockStatus::new(true, false)).unwrap(),
            serde_json::json!({ "isAvailable": false, "deviceIsSecure": true, "kind": "none" })
        );
    }

    #[test]
    fn errors_serialize_as_a_code() {
        assert_eq!(
            serde_json::to_value(AUTHENTICATION_FAILED).unwrap(),
            serde_json::json!({ "code": "authenticationFailed" })
        );
    }

    #[test]
    fn reason_is_trimmed_and_bounded() {
        assert_eq!(
            prompt_reason("  Unlock re/notes ".into(), None),
            Ok("Unlock re/notes".into())
        );
        assert_eq!(prompt_reason("   ".into(), None), Err(INVALID_REASON));
        assert_eq!(
            prompt_reason("x".repeat(MAX_REASON_CHARS + 1), None),
            Err(INVALID_REASON)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_prefers_its_sentence_fragment() {
        assert_eq!(
            prompt_reason("Unlock re/notes".into(), Some("unlock your notes".into())),
            Ok("unlock your notes".into())
        );
        assert_eq!(
            prompt_reason("Unlock re/notes".into(), Some(" ".into())),
            Ok("Unlock re/notes".into())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn local_authentication_errors_map_to_plugin_codes() {
        use objc2_local_authentication::LAError;

        let code = platform::error_code;
        assert_eq!(code(LAError::UserCancel), "userCancel");
        assert_eq!(code(LAError::SystemCancel), "systemCancel");
        assert_eq!(code(LAError::AppCancel), "appCancel");
        assert_eq!(code(LAError::BiometryLockout), "biometryLockout");
        assert_eq!(code(LAError::BiometryNotEnrolled), "biometryNotEnrolled");
        assert_eq!(code(LAError::BiometryDisconnected), "biometryNotAvailable");
        assert_eq!(code(LAError::PasscodeNotSet), "passcodeNotSet");
        assert_eq!(code(LAError::AuthenticationFailed), "authenticationFailed");
        assert_eq!(code(LAError(-9999)), "authenticationFailed");
    }
}
