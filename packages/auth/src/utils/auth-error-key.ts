/**
 * The translation key for an error from the auth API (login, register, 2FA
 * sign-in). The server's `error` field is English text meant for logs, so the
 * UI never shows it as is: a known error gets its own text from the `common`
 * catalog, anything else the caller's fallback (the action's generic text).
 *
 * Usage: `$t(authErrorKey(body.error, 'auth.login.errors.server_error'))`.
 * The keys are pinned by `auth-error-key.spec.ts` against `common/en.json`.
 */
const KNOWN_AUTH_ERRORS: Readonly<Record<string, string>> = {
  'Invalid credentials': 'auth.login.errors.invalid_credentials',
  'Account temporarily locked. Too many failed attempts.': 'auth.login.errors.account_locked',
  'Too many requests. Please try again later.': 'auth.login.errors.too_many_requests',
  'Username already taken': 'auth.register.errors.user_already_exists'
};

export function authErrorKey(serverError: unknown, fallbackKey: string): string {
  return typeof serverError === 'string'
    ? (KNOWN_AUTH_ERRORS[serverError] ?? fallbackKey)
    : fallbackKey;
}

/** Every key `authErrorKey` can return besides the caller's fallback (for tests). */
export const AUTH_ERROR_KEYS: readonly string[] = Object.values(KNOWN_AUTH_ERRORS);
