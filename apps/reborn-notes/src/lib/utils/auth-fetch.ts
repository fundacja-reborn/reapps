import { API_BASE } from '$lib/utils/api-base';
import { createAuthFetch } from '@reborn/auth';
import { sessionExpired } from '$lib/stores/sync-status.store';

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
  refreshUrl: `${API_BASE}/auth/refresh`,
  onSessionExpired: () => sessionExpired.set(true)
});
