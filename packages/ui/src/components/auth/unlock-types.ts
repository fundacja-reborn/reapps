/**
 * Result of an attempt to unlock the account's encryption key with the
 * account password (the `/auth/unlock` screen in both apps).
 *
 * The unlock itself is local: the password opens the wrapped key kept on the
 * device. When that fails and the device is online, the apps ask the server
 * for a fresh wrap (the password may have been changed on another device), so
 * a failure can also come from the server.
 *
 * - `invalid_password`: wrong password. `retryAfterMs` is the delay now in
 *   force (0 during the first few attempts). `offline` is true when the server
 *   could not be asked, so a password changed elsewhere cannot be ruled out.
 * - `throttled`: the attempt was refused because a delay is still running.
 * - `server_locked`: the server's own sign-in lockout (`retryAfter` seconds).
 */
export type UnlockOutcome =
  | { kind: 'ok' }
  | { kind: 'invalid_password'; retryAfterMs: number; offline: boolean }
  | { kind: 'throttled'; retryAfterMs: number }
  | { kind: 'server_locked'; retryAfter: number }
  | { kind: 'error' };

/** Any outcome other than success - what the unlock screen has to explain. */
export type UnlockFailure = Exclude<UnlockOutcome, { kind: 'ok' }>;

/** `m:ss` for a countdown. Always ASCII digits, in every locale. */
export function formatUnlockCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
