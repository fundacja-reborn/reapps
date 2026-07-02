/**
 * Result of a re-authentication attempt after session expiry.
 *
 * `two_factor_required` is returned when the account has 2FA enabled and the
 * password has been verified — the UI must then collect a TOTP/recovery code
 * and call the TOTP verify callback with the `challengeToken` issued by the
 * password step (audit 012 S4: /2fa/verify no longer accepts a raw userId).
 *
 * `challenge_expired` is returned when that token has expired (5-minute TTL)
 * or was already consumed — the UI must return to the password step.
 */
export type ReAuthResult =
  | { kind: 'ok' }
  | { kind: 'invalid_password' }
  | { kind: 'two_factor_required'; challengeToken: string }
  | { kind: 'invalid_totp' }
  | { kind: 'challenge_expired' }
  | { kind: 'locked'; retryAfter: number }
  | { kind: 'error'; message?: string };
