/**
 * Native (Capacitor) client signaling for re/task - the client half.
 *
 * The header contract (`x-reborn-client: native`) is shared with re/notes and
 * lives in `@reborn/auth/native-client`; the server routes check it with
 * `isNativeClient` from `@reborn/auth/server`. This module adds the build-time
 * half: whether THIS bundle is a native shell, and the headers its
 * token-issuing requests (login, 2FA, register, change-password) carry so the
 * server returns the refresh token in the body.
 *
 * Web clients never send the header, so every web response stays
 * byte-identical - the refresh token remains exclusively in the httpOnly
 * cookie and is never exposed to client-side JS.
 */
import { NATIVE_CLIENT_HEADER, NATIVE_CLIENT_VALUE } from '@reborn/auth/native-client';

/**
 * Build-time native (Capacitor) flag - `false` on the web build, so native-only
 * branches are dead-code-eliminated and the web bundle stays unchanged.
 * Defined via `__REBORN_NATIVE__` in vite.config.ts.
 */
export const IS_NATIVE: boolean = __REBORN_NATIVE__;

/**
 * Headers a native client adds to token-issuing requests. Empty on web, so the
 * request headers are unchanged: `{ 'Content-Type': ..., ...nativeAuthHeaders() }`.
 */
export function nativeAuthHeaders(): Record<string, string> {
	return IS_NATIVE ? { [NATIVE_CLIENT_HEADER]: NATIVE_CLIENT_VALUE } : {};
}
