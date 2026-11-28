/**
 * App Lock's biometric prompt for this build: nothing on the web, the shell's
 * own commands on desktop (Tauri, `desktop-app-lock.ts`), and the shared raw
 * Capacitor bridge on the phones (`@reborn/platform/native`, biometric-auth.ts
 * - the same one re/task uses; why it is a raw bridge and not the plugin
 * package: see that module's header and guideline 66).
 *
 * The selection is a compile-time constant per build, so the web bundle drops
 * the bridge and the desktop bundle never reaches Capacitor (its
 * `@capacitor/core` import resolves to `desktop-capacitor-stub.ts`).
 */

import {
  getCapacitorBiometryStatus,
  NO_BIOMETRY,
  promptCapacitorBiometric,
  type BiometricAuthResult,
  type BiometricPromptOptions,
  type BiometryStatus
} from '@reborn/platform/native';
import { getDesktopBiometryStatus, promptDesktopAuth } from './desktop-app-lock';

export type {
  BiometricAuthResult,
  BiometricPromptOptions,
  BiometryKind,
  BiometryStatus
} from '@reborn/platform/native';

/**
 * Query whether biometry is available and enrolled on this device. Returns a
 * "nothing available" status on web or any plugin error, so callers can treat
 * the absence of biometry uniformly.
 */
export async function getBiometryStatus(): Promise<BiometryStatus> {
  if (!__REBORN_NATIVE__) return NO_BIOMETRY;
  // Desktop shell: no Capacitor bridge, the shell's own command answers. A
  // constant ternary, so each build keeps one branch (Rolldown keeps code after
  // an `if (FLAG) return`).
  return __REBORN_DESKTOP__ ? getDesktopBiometryStatus() : getCapacitorBiometryStatus();
}

/**
 * Prompt the user for biometric (or, when `allowDeviceCredential` is set,
 * device-credential) authentication. Resolves `{ ok: true }` on success or
 * `{ ok: false, code }` with a `BiometryErrorType` string. Never rejects.
 */
export async function promptBiometric(
  options: BiometricPromptOptions = {}
): Promise<BiometricAuthResult> {
  if (!__REBORN_NATIVE__) return { ok: false, code: 'biometryNotAvailable' };
  return __REBORN_DESKTOP__ ? promptDesktopAuth(options) : promptCapacitorBiometric(options);
}
