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
  /**
   * Grace period (ms) before treating a definitive refresh failure as
   * session expiry. On the first 401/403 from `/auth/refresh`, the wrapper
   * waits this long and retries once before invoking `onSessionExpired`.
   * Hides brief race conditions (token-rotation across tabs/apps, server
   * cold-start right after a rebuild) at the cost of a small delay on
   * genuine expiry. Defaults to 1500 ms. Set to 0 to disable.
   */
  gracePeriodMs?: number;
}

export interface AuthFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /**
   * Force a refresh now. Resolves to the new access token, or `null` when the
   * server reports a definitive expiry (401/403, or 200 with `success:false`).
   * Throws {@link TransientRefreshError} for transient failures (5xx, network
   * error, timeout) so the caller can distinguish "session is gone" from
   * "server is briefly unreachable" (e.g. nginx returning 502 during a Docker
   * rebuild on the production VPS).
   */
  refresh: () => Promise<string | null>;
}

/**
 * Thrown by {@link AuthFetch.refresh} when `/auth/refresh` failed for a reason
 * that does *not* indicate the session has expired — typically 5xx from nginx
 * during a deploy, a network error, or a timeout. Callers should treat this
 * as a transient sync error (try again later) and **must not** surface the
 * session-expired banner.
 */
export class TransientRefreshError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'TransientRefreshError';
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REFRESH_GRACE_PERIOD_MS = 1500;

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
  const gracePeriodMs = config.gracePeriodMs ?? DEFAULT_REFRESH_GRACE_PERIOD_MS;

  // In-tab single-flight: concurrent 401 handlers share one refresh promise so
  // they don't all hit the server. Cross-tab is serialized via withRefreshLock.
  let refreshPromise: Promise<string | null> | null = null;

  async function doRefreshOnce(tokenBeforeLock: string | null): Promise<string | null> {
    // Inside the cross-tab lock another tab may have already refreshed for us.
    // If the stored access token changed while we were queued, skip the
    // redundant fetch and use the fresh one.
    const current = storage.getAccessToken();
    if (current && current !== tokenBeforeLock) return current;

    let refreshRes: Response;
    try {
      refreshRes = await fetchImpl(config.refreshUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
    } catch (err) {
      // Network error / DNS / timeout — server is unreachable, not an expiry.
      throw new TransientRefreshError(
        err instanceof Error ? err.message : 'Refresh network error',
        err
      );
    }

    // 401/403 = definitive expiry (refresh token revoked, family invalidated,
    // or expired beyond the 7-day sliding window). Caller should mark the
    // session as expired and prompt for re-auth.
    if (refreshRes.status === 401 || refreshRes.status === 403) {
      return null;
    }

    // Any other non-OK status (5xx from nginx during a rebuild, 429 rate
    // limiting, 502/503/504 upstream unavailable) is transient — the refresh
    // token is probably still valid, the server just can't service the
    // request right now. Do NOT trigger the session-expired banner.
    if (!refreshRes.ok) {
      throw new TransientRefreshError(
        `Refresh endpoint returned HTTP ${refreshRes.status}`
      );
    }

    let data: { success?: boolean; data?: { access_token?: string } };
    try {
      data = (await refreshRes.json()) as typeof data;
    } catch (err) {
      // 200 OK but body is not JSON — almost certainly a misbehaving proxy
      // serving a maintenance page. Treat as transient.
      throw new TransientRefreshError('Refresh response was not valid JSON', err);
    }

    // 200 OK with `success:false` is a deliberate expiry signal from the
    // server (e.g. invalid_grant). Treat as definitive.
    if (!data.success || !data.data?.access_token) return null;

    const newToken = data.data.access_token;
    storage.setAccessToken(newToken);
    return newToken;
  }

  async function doRefreshWithGracePeriod(tokenBeforeLock: string | null): Promise<string | null> {
    const first = await doRefreshOnce(tokenBeforeLock);
    if (first !== null) return first;
    if (gracePeriodMs <= 0) return null;

    // Definitive failure on the first attempt. Wait briefly and retry once
    // before reporting session expiry. Hides two classes of false positives
    // without compromising the "401 = expired" signal beyond a small delay:
    //   1. Cross-tab/cross-app token-rotation race where the first attempt
    //      hit a refresh token that was revoked moments earlier by another
    //      window completing its own rotation.
    //   2. Server-side race during deploy/rebuild where the auth handler ran
    //      against a partially-initialized backend (defense-in-depth on top
    //      of the handler-level fix that maps Prisma errors to 5xx).
    // Genuine expiry (token revoked/expired beyond the 7-day window) still
    // surfaces the banner — just gracePeriodMs later.
    await new Promise<void>((resolve) => setTimeout(resolve, gracePeriodMs));

    // Another tab may have refreshed during the wait — use that token if so.
    // Compare against the original tokenBeforeLock so we detect any update
    // that happened during either the lock wait or this grace period.
    const currentAfterWait = storage.getAccessToken();
    if (currentAfterWait && currentAfterWait !== tokenBeforeLock) {
      return currentAfterWait;
    }

    return doRefreshOnce(tokenBeforeLock);
  }

  function refresh(): Promise<string | null> {
    if (!refreshPromise) {
      const tokenBeforeLock = storage.getAccessToken();
      refreshPromise = withRefreshLock(() => doRefreshWithGracePeriod(tokenBeforeLock)).finally(
        () => {
          refreshPromise = null;
        }
      );
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

    let newToken: string | null;
    try {
      newToken = await refresh();
    } catch (err) {
      // Transient refresh failure (5xx from nginx during deploy, network
      // hiccup, timeout). Return the original 401 so the caller can treat it
      // as a regular sync error and retry later. Crucially: do NOT call
      // onSessionExpired — the session is probably still valid, the server
      // is just briefly unreachable.
      if (err instanceof TransientRefreshError) return response;
      throw err;
    }

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
