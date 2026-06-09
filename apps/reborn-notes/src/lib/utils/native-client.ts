/**
 * Native (Capacitor) client signaling - shared client/server contract.
 *
 * The native shell loads its code locally and talks to the API cross-origin,
 * so it cannot use the httpOnly `refresh_token` cookie the web client relies on
 * (a `SameSite=Lax` cookie is never sent on a cross-site request). Instead the
 * native client identifies itself with this header on token-issuing requests,
 * and the server additionally returns the rotated refresh token in the response
 * BODY so the native client can persist it in device secure storage
 * (Keychain / Keystore). See `docs/development/planning/native-faza2-plan.md`.
 *
 * Web clients never send this header, so every web response stays byte-identical
 * to before - the refresh token remains exclusively in the httpOnly cookie and
 * is never exposed to client-side JS.
 *
 * Pure + web-standard (`Request`/`Headers` only), so this module is safe to
 * import from both `+server.ts` handlers and client code.
 */

/** Header a native client sends to opt into the body-token transport. */
export const NATIVE_CLIENT_HEADER = 'x-reborn-client';

/** Value of {@link NATIVE_CLIENT_HEADER} that marks the native shell. */
export const NATIVE_CLIENT_VALUE = 'native';

/**
 * True when the request comes from the native shell (carries the native client
 * header). Server-side gate for the additive "refresh token in body" branch on
 * token-issuing endpoints. `Headers.get` is case-insensitive per the Fetch
 * spec, so header casing from the native HTTP layer does not matter.
 */
export function isNativeClient(request: Request): boolean {
  return request.headers.get(NATIVE_CLIENT_HEADER) === NATIVE_CLIENT_VALUE;
}

/**
 * Build-time native (Capacitor) flag - `false` on the web build, so native-only
 * branches are dead-code-eliminated and the web bundle stays byte-identical.
 * Defined via `__REBORN_NATIVE__` in vite.config.ts (and as `false` in vitest).
 */
export const IS_NATIVE: boolean = __REBORN_NATIVE__;

/**
 * Headers a native client must add to token-issuing requests (login, 2fa,
 * register, change-password) so the server returns the refresh token in the
 * body. Empty on web -> request headers are unchanged. Spread into a fetch's
 * `headers`: `{ 'Content-Type': 'application/json', ...nativeAuthHeaders() }`.
 */
export function nativeAuthHeaders(): Record<string, string> {
  return IS_NATIVE ? { [NATIVE_CLIENT_HEADER]: NATIVE_CLIENT_VALUE } : {};
}
