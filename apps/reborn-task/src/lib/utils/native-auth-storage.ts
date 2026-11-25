/**
 * Native refresh-token persistence for re/task: the implementation shared
 * with re/notes (`@reborn/platform/native`) over the shell's credential store
 * (`getSecureStorage()` - Keychain / Keystore).
 *
 * A native shell cannot ride the web's cross-origin httpOnly cookie, so the
 * refresh token lives here and travels in request bodies. This stores the
 * rotating session refresh token only - NOT the master key.
 *
 * Every function is an inert no-op / null on web: `__REBORN_NATIVE__` is a
 * build-time `false` there, so the bodies (and the storage plugin) are
 * dead-code-eliminated. Storage errors degrade to "no token" (re-login).
 */
import { clearRefreshToken, persistRefreshToken, readRefreshToken } from '@reborn/platform/native';
import { getSecureStorage } from './native-secure-storage';

/** Persist the (rotated) refresh token after login / refresh. No-op on web. */
export async function persistNativeRefreshToken(token: string | null | undefined): Promise<void> {
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
