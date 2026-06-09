/**
 * Native (Capacitor) refresh-token persistence, backed by device secure storage
 * (iOS Keychain / Android Keystore-encrypted) via
 * `@aparajita/capacitor-secure-storage`.
 *
 * The refresh token cannot ride a cross-origin httpOnly cookie in the native
 * shell, so it lives here instead. Every plugin import is gated behind
 * `__REBORN_NATIVE__`, so on the web build the whole branch (and the plugin) is
 * dead-code-eliminated and each function is an inert no-op / null.
 *
 * This stores the rotating session refresh token only - NOT the master key. The
 * master key never leaves the device unencrypted and is never written here.
 *
 * Errors from the secure-storage layer (rare OS failures) are swallowed and
 * degrade to "no token": a read failure surfaces as a missing session
 * (re-login), and createAuthFetch's refresh path handles `null` cleanly. This
 * keeps a broken secure-storage call from throwing out of the refresh flow.
 */

const REFRESH_TOKEN_KEY = 'refresh_token';

/** Persist the (rotated) refresh token after login / refresh. No-op on web. */
export async function persistNativeRefreshToken(
  token: string | null | undefined
): Promise<void> {
  if (!token) return;
  if (__REBORN_NATIVE__) {
    try {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
      await SecureStorage.setItem(REFRESH_TOKEN_KEY, token);
    } catch {
      // Write failed (rare OS error). The current access token is still valid for
      // its lifetime; the next refresh will find no usable token and prompt re-login.
    }
  }
}

/** Read the persisted refresh token, or null if none / on error. null on web. */
export async function readNativeRefreshToken(): Promise<string | null> {
  if (__REBORN_NATIVE__) {
    try {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
      return await SecureStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  }
  return null;
}

/** Remove the persisted refresh token (logout). No-op on web. */
export async function clearNativeRefreshToken(): Promise<void> {
  if (__REBORN_NATIVE__) {
    try {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
      await SecureStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // Best-effort on logout - a failed delete must not block the logout flow.
    }
  }
}
