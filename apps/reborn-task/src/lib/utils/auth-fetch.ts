import { base } from '$app/paths';
import { createAuthFetch } from '@reborn/auth';
import { sessionExpired } from '$lib/stores/session-expired.store';

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
 */
export const authFetch = createAuthFetch({
  refreshUrl: `${base}/api/auth/refresh`,
  onSessionExpired: () => sessionExpired.set(true)
});
