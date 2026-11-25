/**
 * Native-client signaling - the client/server contract of the native shells.
 *
 * A native shell (Capacitor phones, the desktop app) loads its code locally
 * and talks to the API cross-origin, so it cannot use the httpOnly
 * `refresh_token` cookie the web client relies on (a `SameSite=Lax` cookie is
 * never sent on a cross-site request). Instead the native client identifies
 * itself with this header on token-issuing requests, and the server
 * additionally returns the rotated refresh token (and the session id) in the
 * response BODY, so the client can keep the token in device secure storage
 * (Keychain / Keystore). See `planning/native-faza2-plan.md` in reapps-docs.
 *
 * Web clients never send this header, so every web response stays
 * byte-identical - the refresh token remains exclusively in the httpOnly
 * cookie and is never exposed to client-side JS.
 *
 * Pure and web-standard (`Request`/`Headers` only), shared by re/notes and
 * re/task. Client code imports it from `@reborn/auth/native-client` (a
 * side-effect-free entry, so the web bundle drops it with the native branch);
 * server routes get `isNativeClient` from `@reborn/auth/server`.
 */

/** Header a native client sends to opt into the body-token transport. */
export const NATIVE_CLIENT_HEADER = 'x-reborn-client';

/** Value of {@link NATIVE_CLIENT_HEADER} that marks a native shell. */
export const NATIVE_CLIENT_VALUE = 'native';

/**
 * Header carrying a native client's current session id (the web reads it from
 * the httpOnly `session_id` cookie, which never reaches a cross-site native
 * request). Not a secret: a plaintext FK the server stores anyway; every
 * operation stays authorised by the Bearer token. It only lets a native shell
 * name its own session (logout of this device, sessions-list highlight).
 */
export const NATIVE_SESSION_HEADER = 'x-reborn-session-id';

/**
 * True when the request comes from a native shell (carries the native client
 * header). Server-side gate for the additive "refresh token in body" branch of
 * token-issuing endpoints. `Headers.get` is case-insensitive per the Fetch
 * spec, so header casing from the native HTTP layer does not matter.
 */
export function isNativeClient(request: Request): boolean {
  return request.headers.get(NATIVE_CLIENT_HEADER) === NATIVE_CLIENT_VALUE;
}
