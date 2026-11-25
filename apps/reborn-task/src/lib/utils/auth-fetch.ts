import { createAuthFetch } from '@reborn/auth';
import { sessionExpired } from '$lib/stores/session-expired.store';
import { API_BASE } from '$lib/utils/api-base';
import { IS_NATIVE } from '$lib/utils/native-client';
import { persistNativeRefreshToken, readNativeRefreshToken } from '$lib/utils/native-auth-storage';

/**
 * App-level singleton of the authenticated fetch wrapper.
 *
 * - Sends `Authorization: Bearer <access_token>` from `localStorage`.
 * - On 401 from any non-auth endpoint, single-flight refresh (cross-tab via
 *   Web Locks API) and retry the original request once with the new token.
 * - On refresh failure, marks `sessionExpired` so the SessionExpiredBanner
 *   prompts the user to re-authenticate (master key is preserved).
 *
 * Use this wrapper for any direct `fetch()` to the app's API. The same
 * `refresh()` instance is also wired into the `@reborn/api-client` used by
 * sync services (`onUnauthorized`) and into `AuthApiAdapter.refreshToken()`,
 * so all refresh paths share one in-tab single-flight promise.
 *
 * Native shell: the refresh token lives in the Keychain / Keystore (it cannot
 * ride the cross-origin httpOnly cookie) and goes to the dedicated body-token
 * endpoint; the rotated token is persisted back. Web keeps the cookie-based
 * endpoint with no refreshTokenStore - `IS_NATIVE` folds to false there, so
 * the native branch is dead-code-eliminated.
 */
export const authFetch = createAuthFetch({
	refreshUrl: IS_NATIVE ? `${API_BASE}/auth/refresh-native` : `${API_BASE}/auth/refresh`,
	refreshTokenStore: IS_NATIVE
		? { get: readNativeRefreshToken, set: persistNativeRefreshToken }
		: undefined,
	onSessionExpired: () => sessionExpired.set(true)
});
