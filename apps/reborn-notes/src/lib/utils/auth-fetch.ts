import { API_BASE } from '$lib/utils/api-base';
import { createAuthFetch } from '@reborn/auth';
import { sessionExpired } from '$lib/stores/sync-status.store';
import { IS_NATIVE } from '$lib/utils/native-client';
import { persistNativeRefreshToken, readNativeRefreshToken } from '$lib/utils/native-auth-storage';

/**
 * App-level singleton of the authenticated fetch wrapper.
 *
 * Backed by the shared `createAuthFetch` factory in `@reborn/auth`, so the
 * single-flight refresh logic (in-tab Promise + cross-tab Web Locks) is
 * identical to reborn-task and the two apps coordinate through the same
 * lock when both are open on the same origin.
 *
 * Usage: drop-in replacement for `fetch()` in authenticated pages.
 */
export const authFetch = createAuthFetch({
  // Native: dedicated body-token endpoint + secure-storage refresh token.
  // Web: the cookie-based endpoint with no refreshTokenStore (byte-identical -
  // IS_NATIVE folds to false, so the native branch is dead-code-eliminated).
  refreshUrl: IS_NATIVE ? `${API_BASE}/auth/refresh-native` : `${API_BASE}/auth/refresh`,
  refreshTokenStore: IS_NATIVE
    ? { get: readNativeRefreshToken, set: persistNativeRefreshToken }
    : undefined,
  onSessionExpired: () => sessionExpired.set(true)
});
