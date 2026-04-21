import { base } from '$app/paths';
import { sessionExpired } from '$lib/stores/sync-status.store';
import { withRefreshLock } from '@reborn/auth';

/**
 * Fetch wrapper with automatic token refresh for authenticated API calls.
 *
 * If the initial request returns 401, attempts to refresh the access token
 * using the stored refresh_token, then retries the original request once.
 *
 * `withRefreshLock` serializes the refresh across every tab/app on this
 * origin so that reborn-task + reborn-notes cannot both hit /api/auth/refresh
 * with the same refresh-token cookie (which would trip the server-side token
 * reuse detector and invalidate the entire token family). An in-process
 * singleton prevents redundant fetches from concurrent 401s inside one tab.
 *
 * Usage: drop-in replacement for `fetch()` in authenticated pages.
 */

// In-tab singleton: only one refresh fetch can be in-flight inside this tab.
// All concurrent 401 handlers wait on the same promise.
let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(tokenBeforeLock: string | null): Promise<string | null> {
  // Inside the cross-tab lock another tab may have already refreshed for us.
  // If the localStorage access token changed while we were queued, skip the
  // redundant fetch and use the fresh one.
  const current = localStorage.getItem('access_token');
  if (current && current !== tokenBeforeLock) return current;

  try {
    // Refresh token is sent automatically via httpOnly cookie — no need to read from localStorage
    const refreshRes = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!refreshRes.ok) return null;

    const refreshData = await refreshRes.json();
    if (!refreshData.success || !refreshData.data?.access_token) return null;

    const newToken = refreshData.data.access_token;
    localStorage.setItem('access_token', newToken);
    // Note: refresh_token is managed exclusively via httpOnly cookie (set by server)
    return newToken;
  } catch {
    return null;
  }
}

function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    const tokenBeforeLock = localStorage.getItem('access_token');
    refreshPromise = withRefreshLock(() => doRefresh(tokenBeforeLock)).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const accessToken = localStorage.getItem('access_token');

  const headers = new Headers(init?.headers);
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(input, { ...init, headers });

  if (response.status !== 401) return response;

  // Attempt token refresh (singleton — safe for concurrent calls)
  const newToken = await refreshAccessToken();
  if (!newToken) {
    sessionExpired.set(true);
    return response;
  }

  // Retry original request with the new token
  const retryHeaders = new Headers(init?.headers);
  retryHeaders.set('Authorization', `Bearer ${newToken}`);
  return fetch(input, { ...init, headers: retryHeaders });
}
