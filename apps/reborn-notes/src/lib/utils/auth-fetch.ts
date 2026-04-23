import { base } from '$app/paths';
import { sessionExpired } from '$lib/stores/sync-status.store';
import { withRefreshLock } from '@reborn/auth';
import { createLogger } from '@reborn/utils';

const logger = createLogger('AuthFetch');

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

    if (!refreshRes.ok) {
      // DIAGNOSTIC (temporary): surface server-side refresh failure reason so we can
      // distinguish "Token reuse detected" vs "Invalid or expired" vs "No refresh token".
      // Remove once the session-expiry root cause is identified.
      try {
        const errBody = await refreshRes.clone().json();
        logger.warn('/api/auth/refresh failed', {
          status: refreshRes.status,
          body: errBody,
          hasDocumentCookie: typeof document !== 'undefined' && document.cookie.length > 0,
          time: new Date().toISOString()
        });
      } catch (parseErr) {
        logger.warn('/api/auth/refresh failed (non-JSON body)', {
          status: refreshRes.status,
          time: new Date().toISOString(),
          parseErr
        });
      }
      return null;
    }

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

/**
 * Default per-request timeout. Without this a fetch against a VPN black hole
 * (navigator.onLine=true but no upstream) never resolves, so sync's `finally`
 * never runs and the spinner spins forever. Caller-provided `init.signal`
 * takes precedence — if present, we respect it untouched.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function buildSignal(init?: RequestInit): AbortSignal {
  if (init?.signal) return init.signal;
  return AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);
}

export async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const accessToken = localStorage.getItem('access_token');

  const headers = new Headers(init?.headers);
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const signal = buildSignal(init);
  const response = await fetch(input, { ...init, headers, signal });

  if (response.status !== 401) return response;

  // Attempt token refresh (singleton — safe for concurrent calls)
  const newToken = await refreshAccessToken();
  if (!newToken) {
    sessionExpired.set(true);
    return response;
  }

  // Retry original request with the new token. Reuse the same signal so the
  // retry inherits the caller's cancellation / timeout budget.
  const retryHeaders = new Headers(init?.headers);
  retryHeaders.set('Authorization', `Bearer ${newToken}`);
  return fetch(input, { ...init, headers: retryHeaders, signal });
}
