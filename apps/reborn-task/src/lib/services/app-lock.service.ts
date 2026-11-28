/**
 * App Lock in the native shell: the opt-in "require Face ID / fingerprint /
 * the device PIN to open the app" gate, the same feature as in re/notes
 * (guideline 66; decision 2026-11-28: re/task's native lock works like
 * re/notes', the web keeps its password-based App Lock, guideline 82).
 *
 * A UX access gate (option B), not a cryptographic lock: the master key stays
 * Keystore/Keychain-wrapped in the device vault, and the biometric prompt only
 * gates reading it back into memory - on cold start (the crypto restore gate)
 * and on resume after the idle timeout.
 *
 * Scope: account sessions in the native shell (the key lives in the vault).
 * Local-only mode keeps its passcode lock.
 *
 * Layering (as in re/notes):
 *  - enabled flag     -> owned by `@reborn/crypto` (its restore gate reads it)
 *  - idle timeout     -> owned here (localStorage, device-local, not synced)
 *  - biometric prompt -> `native-biometric-auth.ts` (shared raw bridge)
 *  - reactive hasE2E  -> re/task's session manager (instead of notes' store)
 */

import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { platform } from '$lib/platform';
import { authOperationsService } from '$lib/services/auth-operations.service';
import { taskTitleIndex } from '$lib/services/task-title-index.svelte';
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

/** Default idle timeout before resume re-locks: 1 minute (as in re/notes). */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Timeout presets surfaced in settings (ms). `0` = lock immediately on leave. */
export const TIMEOUT_PRESETS_MS = [0, 60_000, 300_000, 900_000] as const;

/** Wall-clock of the last background transition; 0 until the app first pauses. */
let pausedAt = 0;
let lifecycleWired = false;

/** Whether the device offers App Lock (biometry or a device credential). */
export async function getAppLockAvailability(): Promise<BiometryStatus> {
	return getBiometryStatus();
}

/** Whether App Lock is on (synchronous). */
export function isAppLockEnabled(): boolean {
	return cryptoManager.isAppLockEnabled();
}

/** The idle timeout (ms), clamped to a known preset, default 1 min. */
export function getTimeoutMs(): number {
	if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_TIMEOUT_MS;
	const raw = window.localStorage.getItem(TIMEOUT_KEY);
	if (raw === null) return DEFAULT_TIMEOUT_MS;
	const parsed = Number(raw);
	// Only known presets, so a hand-edited value can't disable the lock.
	return (TIMEOUT_PRESETS_MS as readonly number[]).includes(parsed) ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Persist the idle timeout (ms). */
export function setTimeoutMs(ms: number): void {
	if (typeof window === 'undefined' || !window.localStorage) return;
	window.localStorage.setItem(TIMEOUT_KEY, String(ms));
}

/**
 * Start tracking background time once (native boot, root layout). The resume
 * decision lives in the layout's onResume handler, which owns navigation.
 */
export function initAppLock(): void {
	if (!__REBORN_NATIVE__ || lifecycleWired) return;
	lifecycleWired = true;
	platform.lifecycle.onPause(() => {
		pausedAt = Date.now();
	});
}

/**
 * Whether a resume should re-lock: on, currently unlocked, and the app spent
 * at least the idle timeout in the background (never backgrounded = no lock).
 */
export function shouldLockOnResume(): boolean {
	if (!__REBORN_NATIVE__) return false;
	if (!cryptoManager.isAppLockEnabled()) return false;
	if (!cryptoManager.isInitialized()) return false; // already locked
	if (pausedAt === 0) return false;
	return Date.now() - pausedAt >= getTimeoutMs();
}

/**
 * Turn App Lock on. Needs biometry or a device credential, then confirms with a
 * prompt so the user proves they can unlock later. The key stays in the vault
 * (no re-wrap); only the crypto gate flag is set.
 */
export async function enableAppLock(prompts: BiometricPromptOptions): Promise<BiometricAuthResult> {
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

/** Turn App Lock off (from an unlocked session, so no prompt). */
export function disableAppLock(): void {
	cryptoManager.setAppLockEnabled(false);
	logger.info('App Lock disabled');
}

/**
 * Lock now ("Lock now", or a resume past the timeout): the key leaves memory
 * (the vault keeps it for the biometric unlock), the decrypted task index is
 * dropped, and the session flips to "no E2E key" so the layouts stop showing
 * data. The caller navigates to `/auth/applock`; the unlock re-hydrates the
 * stores through the root layout (the same path as after a password unlock).
 */
export function lockNow(): void {
	if (!__REBORN_NATIVE__) return;
	cryptoManager.lockToVault();
	taskTitleIndex.clear();
	authOperationsService.getSessionManager().setSession({ hasE2E: false });
}

/** The unlock attempt in flight, shared by concurrent callers. */
let unlockInFlight: Promise<BiometricAuthResult> | null = null;

/**
 * Unlock from the lock screen: biometric prompt, then read the key back from
 * the vault and mark the session unlocked. `{ ok: false, code: 'vaultEmpty' }`
 * when the prompt passed but the vault held no usable key (the lock screen
 * offers the account password then).
 *
 * Single flight: a second call while a prompt is open (the lock screen
 * mounted twice by a redirect) gets the same attempt instead of a second
 * system prompt - two at once hung Android's System UI in the 2026-11-28
 * smoke test.
 */
export function unlock(prompts: BiometricPromptOptions): Promise<BiometricAuthResult> {
	if (!__REBORN_NATIVE__) return Promise.resolve({ ok: false, code: 'biometryNotAvailable' });
	unlockInFlight ??= runUnlock(prompts).finally(() => {
		unlockInFlight = null;
	});
	return unlockInFlight;
}

async function runUnlock(prompts: BiometricPromptOptions): Promise<BiometricAuthResult> {
	const result = await promptBiometric({ allowDeviceCredential: true, ...prompts });
	if (!result.ok) return result;
	try {
		if (!(await cryptoManager.unlockFromVault())) return { ok: false, code: 'vaultEmpty' };
		authOperationsService.getSessionManager().setSession({ hasE2E: true });
		// An unlock followed straight by background -> resume must not re-lock
		// before the user did anything.
		pausedAt = 0;
		return { ok: true };
	} catch (error: unknown) {
		logger.error('Vault read after biometric unlock failed:', error);
		return { ok: false, code: 'vaultEmpty' };
	}
}
