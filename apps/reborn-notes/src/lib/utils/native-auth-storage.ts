/**
 * Native refresh-token persistence for re/notes: the shared implementation in
 * `@reborn/platform/native` over this build's credential store
 * (`getSecureStorage()` - Keychain / Keystore on the phones, the OS store on
 * desktop).
 *
 * The refresh token cannot ride a cross-origin httpOnly cookie in a native
 * shell, so it lives here instead. This stores the rotating session refresh
 * token only - NOT the master key.
 *
 * Every function is an inert no-op / null on web: `__REBORN_NATIVE__` is a
 * build-time `false` there, so the bodies (and the storage plugin) are
 * dead-code-eliminated. Storage errors degrade to "no token" (re-login); see
 * the package module.
 */

import {
  clearRefreshToken,
  persistRefreshToken,
  readRefreshToken
} from '@reborn/platform/native';
import { getSecureStorage } from './native-secure-storage';

/** Persist the (rotated) refresh token after login / refresh. No-op on web. */
export async function persistNativeRefreshToken(
  token: string | null | undefined
): Promise<void> {
  if (__REBORN_NATIVE__) await persistRefreshToken(getSecureStorage, token);
}

/** Read the persisted refresh token, or null if none / on error. null on web. */
export async function readNativeRefreshToken(): Promise<string | null> {
  return __REBORN_NATIVE__ ? readRefreshToken(getSecureStorage) : null;
}

/** Remove the persisted refresh token (logout). No-op on web. */
export async function clearNativeRefreshToken(): Promise<void> {
  if (__REBORN_NATIVE__) await clearRefreshToken(getSecureStorage);
}
