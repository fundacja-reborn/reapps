/**
 * App Lock prompt for the desktop (Tauri) shell, behind the shell's
 * `app_lock_*` commands (`src-tauri/src/app_lock.rs`).
 *
 * Same contract as the Capacitor biometric plugin that `native-biometric-auth.ts`
 * talks to on the phones, which hands out these functions on desktop builds -
 * so `app-lock.service.ts`, the lock screen and the settings screen work
 * unchanged. The shell answers with the plugin's own vocabulary: the status
 * fields of `checkBiometry` and a `{ code }` rejection with a
 * `BiometryErrorType` string.
 *
 * On macOS the system prompt is LocalAuthentication: Touch ID when it is set
 * up, the macOS account password otherwise (and always as the fallback).
 */

import { invokeDesktop, invokeDesktopDialog } from './desktop-bridge';
import type {
  BiometricAuthResult,
  BiometricPromptOptions,
  BiometryStatus
} from './native-biometric-auth';

/** Shape of `app_lock_status`. */
interface ShellAppLockStatus {
  isAvailable?: unknown;
  deviceIsSecure?: unknown;
  kind?: unknown;
}

const NOTHING_AVAILABLE: BiometryStatus = {
  isAvailable: false,
  deviceIsSecure: false,
  kind: 'none'
};

/** Whether the system can show the unlock prompt. Never rejects. */
export async function getDesktopBiometryStatus(): Promise<BiometryStatus> {
  try {
    const status = await invokeDesktop<ShellAppLockStatus>('app_lock_status');
    return {
      isAvailable: status.isAvailable === true,
      deviceIsSecure: status.deviceIsSecure === true,
      // The shell reports Touch ID only; anything else is a password prompt.
      kind: status.kind === 'touchId' ? 'touchId' : 'none'
    };
  } catch {
    return NOTHING_AVAILABLE;
  }
}

/** The `BiometryErrorType` carried by a shell rejection. */
function codeOf(rejection: unknown): string {
  if (typeof rejection === 'object' && rejection !== null && 'code' in rejection) {
    const { code } = rejection as { code: unknown };
    if (typeof code === 'string' && code) return code;
  }
  return 'authenticationFailed';
}

/**
 * Show the system unlock prompt. Resolves `{ ok: true }` on success or
 * `{ ok: false, code }` otherwise (`userCancel` when the user dismissed it).
 * Never rejects.
 *
 * The device password is always allowed: on a Mac it is the account password,
 * which every Mac has, so `allowDeviceCredential` has nothing to switch off.
 */
export async function promptDesktopAuth(
  options: BiometricPromptOptions = {}
): Promise<BiometricAuthResult> {
  try {
    await invokeDesktopDialog<null>('app_lock_authenticate', {
      reason: options.reason ?? '',
      macosReason: options.macosReason ?? null
    });
    return { ok: true };
  } catch (rejection) {
    return { ok: false, code: codeOf(rejection) };
  }
}
