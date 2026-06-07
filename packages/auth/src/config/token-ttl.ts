/**
 * Refresh-token lifetime - single source of truth.
 *
 * A session's effective lifetime is the MINIMUM of three sliding gates, each
 * reset on every successful refresh rotation:
 *   1. the `refresh_token` cookie `maxAge` (if the browser drops it, the next
 *      refresh has no cookie -> 401 "No refresh token provided"),
 *   2. the DB `RefreshToken.expires_at` (checked in `handleRefreshToken`),
 *   3. the `UserSession.expires_at` (gates the "active devices" list + cleanup;
 *      not a refresh gate itself, but kept consistent so a device does not vanish
 *      from the list while its refresh token is still valid).
 *
 * The refresh JWT's own `exp` claim is NOT a gate: `handleRefreshToken` treats the
 * refresh token as an opaque DB key and never verifies it as a JWT. We still keep
 * the JWT `exp` in sync (via REFRESH_TOKEN_TTL_TIMESPAN) so the three forms below
 * never drift from each other.
 *
 * Retune session longevity by changing ONLY this constant; every gate derives from it.
 */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/** Seconds form - for cookie `maxAge` and millisecond math. */
export const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

/** jose `setExpirationTime` timespan form (e.g. "30d") for the refresh JWT `exp`. */
export const REFRESH_TOKEN_TTL_TIMESPAN = `${REFRESH_TOKEN_TTL_DAYS}d`;

/**
 * Absolute expiry `Date` (now + TTL) for DB `expires_at` columns
 * (`RefreshToken.expires_at`, `UserSession.expires_at`).
 *
 * @param from - base instant; defaults to now. Exposed for deterministic tests.
 */
export function refreshTokenExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}
