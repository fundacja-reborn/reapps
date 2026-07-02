/**
 * Local-mode passcode policy: shared constants and helpers for the optional
 * at-rest wrap of the local master key (see cryptoManager "Local-mode
 * passcode" section). Centralized here so the crypto layer ENFORCES the same
 * rules the settings UI merely displays (audit 012 N6 - the minimum length
 * used to live only in the two apps' pages, so any direct caller could set
 * "1").
 *
 * The failure throttle implemented on top of these helpers is friction, not a
 * hard boundary: the wrap lives in web-readable storage, so an attacker with
 * scripting access to the origin can brute-force offline regardless. It
 * defends against the realistic case - someone holding the device typing
 * guesses into the lock screen - where each attempt already costs one PBKDF2
 * 600K derivation and now also waits out a growing delay.
 */

/** Minimum passcode length, enforced by enable/change and shown by the UI. */
export const LOCAL_PASSCODE_MIN_LENGTH = 6;

/** Consecutive failures allowed before the retry delay kicks in. */
export const LOCAL_PASSCODE_FREE_ATTEMPTS = 3;

/** Upper bound on the retry delay (15 min), reached after ~10 failures. */
export const LOCAL_PASSCODE_MAX_DELAY_MS = 15 * 60 * 1000;

/**
 * Delay before the next unlock attempt after `failedCount` consecutive
 * failures: none for the first {@link LOCAL_PASSCODE_FREE_ATTEMPTS}, then 10 s
 * doubling per failure up to {@link LOCAL_PASSCODE_MAX_DELAY_MS}. At the cap,
 * 100 attempts take over a day - enough to make guessing a weak numeric code
 * on-device impractical.
 */
export function localPasscodeRetryDelayMs(failedCount: number): number {
  if (failedCount < LOCAL_PASSCODE_FREE_ATTEMPTS) return 0;
  const doublings = failedCount - LOCAL_PASSCODE_FREE_ATTEMPTS;
  // Past the cap 2**doublings overflows quickly; clamp the exponent first.
  if (doublings > 30) return LOCAL_PASSCODE_MAX_DELAY_MS;
  return Math.min(10_000 * 2 ** doublings, LOCAL_PASSCODE_MAX_DELAY_MS);
}

/**
 * Thrown by `unlockWithLocalPasscode` when an attempt is made inside the
 * failure-throttle window. Carries the remaining wait so lock screens can show
 * a countdown instead of a misleading "wrong passcode".
 */
export class LocalPasscodeThrottledError extends Error {
  /** Milliseconds until the next attempt is allowed. */
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Local passcode unlock throttled - retry in ${Math.ceil(retryAfterMs / 1000)} s`);
    this.name = 'LocalPasscodeThrottledError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Soft quality check for a new passcode: flags the two patterns that dominate
 * real-world guess lists - one repeated character ("111111", "aaaaaa") and a
 * straight run in either direction ("123456", "abcdef", "987654"). Advisory
 * only: the settings UI shows a warning but does not block, since the passcode
 * is an optional extra layer over local-only data (audit 012 N6, "soft quality
 * assessment"). Deliberately heuristic - no wordlists, no dependencies.
 */
export function isTriviallyGuessablePasscode(passcode: string): boolean {
  if (passcode.length < 2) return true;
  const codes = Array.from(passcode).map((ch) => ch.codePointAt(0) as number);
  const step = codes[1] - codes[0];
  if (step !== 0 && step !== 1 && step !== -1) return false;
  for (let i = 2; i < codes.length; i++) {
    if (codes[i] - codes[i - 1] !== step) return false;
  }
  return true;
}
