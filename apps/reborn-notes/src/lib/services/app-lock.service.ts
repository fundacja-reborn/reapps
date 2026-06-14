/**
 * App Lock (native biometric gate) service.
 *
 * Coordinates the opt-in "require Face ID / fingerprint to open the app"
 * feature for the Capacitor shell. It is a UX access gate (option B): the
 * master key stays Keystore/Keychain-wrapped in the vault; the biometric prompt
 * only gates *reading* it back into memory, on cold start and on resume after
 * an idle timeout. It is NOT a cryptographic lock - see
 * planning/native-app-lock-biometric-plan.md (and `@reborn/crypto`
 * cryptoManager App Lock section) for the honest framing and the future
 * crypto-bound option C.
 *
 * Scope: account-mode native sessions, where the key lives in the vault.
 * Local-only mode keeps its passcode lock (a real at-rest crypto lock); this
 * service stays out of its way (the crypto gate is mutually exclusive with the
 * passcode wrap).
 *
 * Layering:
 *  - enabled flag       → owned by `@reborn/crypto` (its restore gate reads it)
 *  - idle timeout       → owned here (localStorage, device-local, not synced)
 *  - biometric prompt   → `native-biometric-auth.ts` (raw bridge)
 *  - reactive hasE2E    → `auth.store.ts` (markE2EUnlocked / lockAppNow)
 *
 * Everything is gated on `__REBORN_NATIVE__` so the web build drops the module.
 */

import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { platform } from '$lib/platform';
import { authStore } from '$lib/stores/auth.store';
import {
  getBiometryStatus,
  promptBiometric,
  type BiometricAuthResult,
  type BiometricPromptOptions,
  type BiometryStatus
} from '$lib/utils/native-biometric-auth';

const logger = createLogger('AppLock');

/** localStorage key for the idle timeout (ms). Device-local, never synced. */
const TIMEOUT_KEY = 'reborn_app_lock_timeout_ms';

/** Default idle timeout before resume re-locks: 1 minute (decision, 2026-06-14). */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Timeout presets surfaced in settings (ms). `0` = lock immediately on leave. */
export const TIMEOUT_PRESETS_MS = [0, 60_000, 300_000, 900_000] as const;

/** Wall-clock of the last background transition; 0 until the app first pauses. */
let pausedAt = 0;
let lifecycleWired = false;

/** Whether the device offers App Lock (native + biometry or device credential). */
export async function getAppLockAvailability(): Promise<BiometryStatus> {
  return getBiometryStatus();
}

/** Whether App Lock is currently enabled (synchronous). */
export function isAppLockEnabled(): boolean {
  return cryptoManager.isAppLockEnabled();
}

/** Read the idle timeout (ms), clamped to a known preset, default 1 min. */
export function getTimeoutMs(): number {
  if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_TIMEOUT_MS;
  const raw = window.localStorage.getItem(TIMEOUT_KEY);
  if (raw === null) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  // Accept only known presets so a hand-edited value can't disable the lock.
  return (TIMEOUT_PRESETS_MS as readonly number[]).includes(parsed)
    ? parsed
    : DEFAULT_TIMEOUT_MS;
}

/** Persist the idle timeout (ms). */
export function setTimeoutMs(ms: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(TIMEOUT_KEY, String(ms));
}

/**
 * Wire the background-timestamp tracker once. Called from hooks.client.ts on
 * native boot. The resume-side decision lives in the layout's onResume handler
 * (it owns navigation + the auth store), which calls `shouldLockOnResume()`.
 */
export function initAppLock(): void {
  if (!__REBORN_NATIVE__ || lifecycleWired) return;
  lifecycleWired = true;
  platform.lifecycle.onPause(() => {
    pausedAt = Date.now();
  });
}

/**
 * Whether a resume should re-lock the app: enabled, currently unlocked, and the
 * app spent at least the idle timeout in the background. `pausedAt === 0`
 * (never backgrounded) never locks.
 */
export function shouldLockOnResume(): boolean {
  if (!__REBORN_NATIVE__) return false;
  if (!cryptoManager.isAppLockEnabled()) return false;
  if (!cryptoManager.isInitialized()) return false; // already locked
  if (pausedAt === 0) return false;
  return Date.now() - pausedAt >= getTimeoutMs();
}

/**
 * Enable App Lock. Requires biometry (or a device credential) to be available,
 * then confirms with a prompt so the user proves they can unlock later. On
 * success the crypto gate flag is set; the key stays in the vault (no re-wrap).
 * `prompts` carries the localized dialog strings from the caller.
 */
export async function enableAppLock(
  prompts: BiometricPromptOptions
): Promise<BiometricAuthResult> {
  if (!__REBORN_NATIVE__) return { ok: false, code: 'biometryNotAvailable' };
  const status = await getBiometryStatus();
  if (!status.isAvailable && !status.deviceIsSecure) {
    return { ok: false, code: 'biometryNotEnrolled' };
  }
  const result = await promptBiometric({ allowDeviceCredential: true, ...prompts });
  if (!result.ok) return result;
  cryptoManager.setAppLockEnabled(true);
  if (getTimeoutMs() === DEFAULT_TIMEOUT_MS) setTimeoutMs(DEFAULT_TIMEOUT_MS);
  logger.info('App Lock enabled');
  return { ok: true };
}

/**
 * Disable App Lock. No prompt: the caller is in an unlocked session (settings).
 * Clears the gate flag; the key remains in the vault and auto-restores normally
 * on the next cold start.
 */
export function disableAppLock(): void {
  cryptoManager.setAppLockEnabled(false);
  logger.info('App Lock disabled');
}

/** Lock the app now (manual "Lock now" / settings). Shows the lock screen. */
export function lockNow(): void {
  authStore.lockAppNow();
}

/**
 * Drive an unlock attempt from the lock screen: biometric prompt, then read the
 * key back from the vault and flip the auth store. Returns `{ ok: false, code }`
 * on a failed/cancelled prompt or a vault read that yielded no key. `prompts`
 * carries the localized dialog strings.
 */
export async function unlock(prompts: BiometricPromptOptions): Promise<BiometricAuthResult> {
  if (!__REBORN_NATIVE__) return { ok: false, code: 'biometryNotAvailable' };
  const result = await promptBiometric({ allowDeviceCredential: true, ...prompts });
  if (!result.ok) return result;
  try {
    const restored = await cryptoManager.unlockFromVault();
    if (!restored) {
      // Prompt passed but the vault held no usable key (cleared/corrupt). The
      // lock screen offers the account-password fallback for this case.
      return { ok: false, code: 'vaultEmpty' };
    }
    authStore.markE2EUnlocked();
    // Reset the timer so a unlock immediately followed by a background→resume
    // doesn't re-lock before the user does anything.
    pausedAt = 0;
    return { ok: true };
  } catch (error: unknown) {
    logger.error('Vault read after biometric unlock failed:', error);
    return { ok: false, code: 'vaultEmpty' };
  }
}
