/**
 * Web App Lock policy: storage names, idle presets and the pure decisions
 * behind the opt-in lock for account sessions in the browser / PWA.
 *
 * Model (see cryptoManager "Web App Lock" section): while the lock is enabled
 * the master key lives in the memory of open tabs only. Nothing unwrapped is
 * kept in IndexedDB or sessionStorage, so the only at-rest form is the
 * account's password-wrapped key (the same envelope the server stores).
 * Locking clears the in-memory key in every tab; unlocking re-derives it from
 * the account password in one tab, which then hands it to the other open tabs
 * of the origin in memory (never through storage).
 *
 * Everything here is device-local and never synced. The lock is off by
 * default: with no config record the app behaves exactly as before (the key is
 * persisted and restored without a prompt).
 */

/**
 * localStorage record that turns the lock on: `{ v, timeoutMs }`. Its presence
 * means "enabled". Shared by both apps (same origin).
 */
export const WEB_LOCK_CONFIG_KEY = 'reborn_web_lock';

/** localStorage: epoch ms of the last user activity in any tab of the origin. */
export const WEB_LOCK_ACTIVITY_KEY = 'reborn_web_lock_activity';

/**
 * localStorage: epoch ms of the last lock. A tab whose key was loaded before
 * this moment locks itself - the cross-tab signal. A timestamp (not a
 * BroadcastChannel message) because a frozen tab drops channel messages but
 * can still read storage when it wakes up.
 */
export const WEB_LOCK_EPOCH_KEY = 'reborn_web_lock_epoch';

/**
 * localStorage key of the account credentials record (owned by the apps'
 * auth layer). The lock only exists for an account session: the account's
 * wrapped key is what unlocks it. Without this record (logged out, or
 * local-only mode, whose key has no wrap) a leftover config must stay inert -
 * otherwise the restore gate would refuse a key that nothing can re-derive.
 */
export const WEB_LOCK_ACCOUNT_MARKER_KEY = 'reborn_auth_credentials';

/**
 * BroadcastChannel over which an unlocked tab hands the key to a locked tab
 * of the same origin. In-memory, same-origin delivery only - nothing is
 * written to disk, so "closed browser = locked" still holds.
 */
export const WEB_LOCK_HANDOFF_CHANNEL = 'reborn_web_lock_handoff';

/**
 * How long a tab waits for another tab to answer a key request. A reply takes
 * a few milliseconds; the wait only shows as a short delay before the unlock
 * form when no other tab is unlocked.
 */
export const WEB_LOCK_HANDOFF_TIMEOUT_MS = 300;

/** localStorage: failed account-unlock attempts, `{ count, lockedUntil }`. */
export const ACCOUNT_UNLOCK_ATTEMPTS_KEY = 'reborn_unlock_attempts';

/** Idle preset meaning "never lock on idle" (manual lock and cold start only). */
export const WEB_LOCK_TIMEOUT_NEVER = 0;

/** Default idle timeout: 5 minutes. Unlocking means typing a password. */
export const WEB_LOCK_DEFAULT_TIMEOUT_MS = 5 * 60_000;

/**
 * Idle presets offered in settings (ms). No "immediately": on a desktop every
 * switch to another window would end in a password prompt.
 */
export const WEB_LOCK_TIMEOUT_PRESETS_MS = [
  60_000,
  WEB_LOCK_DEFAULT_TIMEOUT_MS,
  15 * 60_000,
  60 * 60_000,
  WEB_LOCK_TIMEOUT_NEVER
] as const;

/** Format version of the config record. */
export const WEB_LOCK_CONFIG_VERSION = 1;

/**
 * How far the clock may run backwards before the idle check treats it as
 * tampering / a reset and locks. Small corrections (NTP) stay below this.
 */
const CLOCK_ROLLBACK_TOLERANCE_MS = 60_000;

/**
 * Clamp a stored / requested idle timeout to a known preset, so a hand-edited
 * value can neither disable the idle lock nor set an absurd one.
 */
export function normalizeWebLockTimeout(value: unknown): number {
  return typeof value === 'number' &&
    (WEB_LOCK_TIMEOUT_PRESETS_MS as readonly number[]).includes(value)
    ? value
    : WEB_LOCK_DEFAULT_TIMEOUT_MS;
}

/**
 * Whether the idle timeout has run out. Decided from recorded timestamps, not
 * from a timer: background tabs have throttled timers and frozen ones have
 * none, so the check runs whenever the tab gets a chance (tick, focus, return).
 *
 * `timeoutMs` of {@link WEB_LOCK_TIMEOUT_NEVER} never expires. A clock that
 * moved backwards past the tolerance counts as expired (fail closed).
 */
export function isWebLockIdleExpired(
  now: number,
  lastActivity: number,
  timeoutMs: number
): boolean {
  if (timeoutMs <= WEB_LOCK_TIMEOUT_NEVER) return false;
  const idleMs = now - lastActivity;
  if (idleMs < -CLOCK_ROLLBACK_TOLERANCE_MS) return true;
  return idleMs >= timeoutMs;
}

/** Parse a stored epoch-ms value; anything unreadable counts as "never". */
export function parseStoredTimestamp(raw: string | null | undefined): number {
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
