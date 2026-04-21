/**
 * Result of a re-authentication attempt after session expiry.
 *
 * `two_factor_required` is returned when the account has 2FA enabled and the
 * password has been verified — the UI must then collect a TOTP/recovery code
 * and call the TOTP verify callback with `userId`.
 */
export type ReAuthResult =
  | { kind: 'ok' }
  | { kind: 'invalid_password' }
  | { kind: 'two_factor_required'; userId: string }
  | { kind: 'invalid_totp' }
  | { kind: 'locked'; retryAfter: number }
  | { kind: 'error'; message?: string };
