/**
 * Native (Capacitor / desktop) client signaling for re/notes - the client half.
 *
 * The header contract itself (`x-reborn-client: native`) is shared with
 * re/task and lives in `@reborn/auth/native-client` (the server routes check
 * it with `isNativeClient` from `@reborn/auth/server`). This module adds the
 * build-time half: whether THIS bundle is a native shell, and the headers its
 * token-issuing requests carry.
 *
 * Web clients never send the header, so every web response stays
 * byte-identical - the refresh token remains exclusively in the httpOnly
 * cookie and is never exposed to client-side JS.
 */
import { NATIVE_CLIENT_HEADER, NATIVE_CLIENT_VALUE } from '@reborn/auth/native-client';

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
