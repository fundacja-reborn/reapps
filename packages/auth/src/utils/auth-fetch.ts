import { withRefreshLock } from './refresh-lock';

/**
 * Authenticated fetch wrapper with single-flight token refresh.
 *
 * On 401 from any non-auth endpoint, attempts to refresh the access token
 * (single-flight per tab + cross-tab serialized via Web Locks API), then
 * retries the original request once with the new token. If refresh fails,
 * invokes `onSessionExpired` so the app can surface the session-expired UI.
 *
 * The cross-tab lock prevents two tabs (or two apps on the same origin) from
 * both POSTing /api/auth/refresh with the same refresh-token cookie, which
 * would trip the server's token-reuse detector and revoke the entire family.
 *
 * Usage:
 *   const authFetch = createAuthFetch({
 *     refreshUrl: '/task/api/auth/refresh',
 *     onSessionExpired: () => sessionExpired.set(true)
 *   });
 *
 *   await authFetch('/task/api/tasks');           // GET with Bearer header
 *   await authFetch.refresh();                    // proactive refresh
 */

export interface AuthFetchTokenStorage {
  getAccessToken: () => string | null;
  setAccessToken: (token: string) => void;
}

export interface AuthFetchConfig {
  /** Absolute or relative URL of the POST /auth/refresh endpoint. */
  refreshUrl: string;
  /** Default per-request timeout in ms. Caller-provided `init.signal` overrides. */
  defaultTimeoutMs?: number;
  /** Callback when refresh fails — typically marks session expired. */
  onSessionExpired?: () => void;
  /** Token storage adapter — defaults to localStorage 'access_token'. */
  storage?: AuthFetchTokenStorage;
  /** Override fetch impl (tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export interface AuthFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Force a refresh now, returning the new access token or null on failure. */
  refresh: () => Promise<string | null>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

const defaultStorage: AuthFetchTokenStorage = {
  getAccessToken: () =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('access_token') : null,
  setAccessToken: (token: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('access_token', token);
  }
};

export function createAuthFetch(config: AuthFetchConfig): AuthFetch {
  const storage = config.storage ?? defaultStorage;
  const timeoutMs = config.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const fetchImpl = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  // In-tab single-flight: concurrent 401 handlers share one refresh promise so
  // they don't all hit the server. Cross-tab is serialized via withRefreshLock.
  let refreshPromise: Promise<string | null> | null = null;

  async function doRefresh(tokenBeforeLock: string | null): Promise<string | null> {
    // Inside the cross-tab lock another tab may have already refreshed for us.
    // If the stored access token changed while we were queued, skip the
    // redundant fetch and use the fresh one.
    const current = storage.getAccessToken();
    if (current && current !== tokenBeforeLock) return current;

    const refreshRes = await fetchImpl(config.refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!refreshRes.ok) return null;

    const data = (await refreshRes.json()) as {
      success?: boolean;
      data?: { access_token?: string };
    };
    if (!data.success || !data.data?.access_token) return null;

    const newToken = data.data.access_token;
    storage.setAccessToken(newToken);
    return newToken;
  }

  function refresh(): Promise<string | null> {
    if (!refreshPromise) {
      const tokenBeforeLock = storage.getAccessToken();
      refreshPromise = withRefreshLock(() => doRefresh(tokenBeforeLock)).finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  function buildSignal(init?: RequestInit): AbortSignal {
    if (init?.signal) return init.signal;
    return AbortSignal.timeout(timeoutMs);
  }

  const authFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const accessToken = storage.getAccessToken();

    const headers = new Headers(init?.headers);
    if (accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const signal = buildSignal(init);
    const response = await fetchImpl(input, { ...init, headers, signal });

    if (response.status !== 401) return response;

    const newToken = await refresh();
    if (!newToken) {
      config.onSessionExpired?.();
      return response;
    }

    // Retry original request with the new token. Reuse the same signal so the
    // retry inherits the caller's cancellation / timeout budget.
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set('Authorization', `Bearer ${newToken}`);
    return fetchImpl(input, { ...init, headers: retryHeaders, signal });
  }) as AuthFetch;

  authFetch.refresh = refresh;
  return authFetch;
}
