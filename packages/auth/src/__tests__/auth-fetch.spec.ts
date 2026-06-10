import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthFetch,
  TransientRefreshError,
  type AuthFetchTokenStorage
} from '../utils/auth-fetch';

function makeStorage(initial: string | null = null): AuthFetchTokenStorage & { value: string | null } {
  const state = { value: initial };
  return {
    value: state.value,
    getAccessToken: () => state.value,
    setAccessToken: (t: string) => {
      state.value = t;
    }
  } as never;
}

/** In-memory native refresh-token store (stands in for Keychain/Keystore). */
function makeRefreshStore(initial: string | null = null) {
  const state = { value: initial };
  return {
    get: () => state.value,
    set: (t: string) => {
      state.value = t;
    }
  };
}

describe('createAuthFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('attaches Bearer header from storage on the initial request', async () => {
    const storage = makeStorage('access-1');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl
    });

    await authFetch('/api/things');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer access-1');
  });

  it('does not overwrite caller-provided Authorization header', async () => {
    const storage = makeStorage('access-from-storage');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl
    });

    await authFetch('/api/things', {
      headers: { Authorization: 'Bearer caller-token' }
    });

    const [, init] = fetchImpl.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer caller-token');
  });

  it('refreshes on 401 and retries with the new token', async () => {
    const storage = makeStorage('expired');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { access_token: 'fresh' } }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    // Initial request used expired token
    expect((fetchImpl.mock.calls[0][1].headers as Headers).get('Authorization')).toBe(
      'Bearer expired'
    );

    // Refresh call to refreshUrl
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/auth/refresh');
    expect((fetchImpl.mock.calls[1][1] as RequestInit).method).toBe('POST');

    // Retry request used fresh token
    expect((fetchImpl.mock.calls[2][1].headers as Headers).get('Authorization')).toBe(
      'Bearer fresh'
    );

    expect(storage.getAccessToken()).toBe('fresh');
  });

  it('invokes onSessionExpired and returns the original 401 when refresh fails', async () => {
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh failed', { status: 401 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      // Disable grace-period for this test — we're verifying the immediate
      // definitive-expiry path, not the retry behavior (covered separately).
      gracePeriodMs: 0
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    // No retry happened — only initial + refresh attempt
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Storage left untouched
    expect(storage.getAccessToken()).toBe('expired');
  });

  it('serializes concurrent 401s through a single in-flight refresh', async () => {
    const storage = makeStorage('expired');

    let resolveRefresh!: (value: Response) => void;
    const refreshPending = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/auth/refresh') return refreshPending;
      const tokenHeader = (init?.headers as Headers | undefined)?.get('Authorization');
      if (tokenHeader === 'Bearer fresh')
        return Promise.resolve(new Response('ok', { status: 200 }));
      return Promise.resolve(new Response('expired', { status: 401 }));
    });

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl
    });

    const calls = [authFetch('/api/things/a'), authFetch('/api/things/b'), authFetch('/api/things/c')];

    // Allow microtasks to flush so all three are blocked on the refresh
    await Promise.resolve();
    await Promise.resolve();

    resolveRefresh(
      new Response(JSON.stringify({ success: true, data: { access_token: 'fresh' } }), {
        status: 200
      })
    );

    const responses = await Promise.all(calls);
    expect(responses.every((r) => r.status === 200)).toBe(true);

    const refreshCalls = fetchImpl.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
  });

  it('exposes refresh() for proactive refresh', async () => {
    const storage = makeStorage('old');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { access_token: 'new' } }), {
        status: 200
      })
    );

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl
    });

    const newToken = await authFetch.refresh();

    expect(newToken).toBe('new');
    expect(storage.getAccessToken()).toBe('new');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/auth/refresh');
  });

  it('returns null from refresh() when server rejects', async () => {
    const storage = makeStorage('old');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'invalid' }), { status: 401 })
    );

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      // Disable grace-period for this test — testing the bare refresh()
      // result, not retry behavior (covered separately).
      gracePeriodMs: 0
    });

    const newToken = await authFetch.refresh();

    expect(newToken).toBeNull();
    expect(storage.getAccessToken()).toBe('old'); // unchanged
    // refresh() itself does NOT call onSessionExpired — that's the wrapper's job on 401-driven refresh.
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  // --- Transient vs definitive refresh failure ---
  //
  // Regression coverage for the production-deploy bug: nginx returns 5xx for
  // a few seconds during `docker compose up -d --build`, which used to flip
  // the session-expired banner on mobile (where the access token had expired
  // in the background and the very first post-resume sync hit the deploy
  // window). The session is still valid — the server is just briefly down.

  it('does NOT call onSessionExpired when refresh hits a 5xx (transient)', async () => {
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired
    });

    const response = await authFetch('/api/things');

    // Original 401 surfaces to caller; sync layer treats as transient and retries.
    expect(response.status).toBe(401);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(storage.getAccessToken()).toBe('expired');
  });

  it('does NOT call onSessionExpired when refresh fetch throws (network/timeout)', async () => {
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(401);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('still calls onSessionExpired on a definitive 401 from refresh', async () => {
    // Regression guard: the transient-error change must not weaken the
    // signal for an actually-expired refresh token (token reuse → entire
    // family revoked → 401 from /auth/refresh).
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      // Disable grace-period — this test covers the immediate definitive
      // signal. Grace-period retry behavior is covered by dedicated tests.
      gracePeriodMs: 0
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it('refresh() throws TransientRefreshError on 5xx', async () => {
    const storage = makeStorage('old');
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('Service Unavailable', { status: 503 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl
    });

    await expect(authFetch.refresh()).rejects.toBeInstanceOf(TransientRefreshError);
    expect(storage.getAccessToken()).toBe('old');
  });

  it('refresh() throws TransientRefreshError on network error', async () => {
    const storage = makeStorage('old');
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl
    });

    await expect(authFetch.refresh()).rejects.toBeInstanceOf(TransientRefreshError);
  });

  // --- Grace period (single retry before banner) ---
  //
  // After a first definitive 401 from `/auth/refresh`, the wrapper waits
  // briefly and retries once before invoking `onSessionExpired`. Hides
  // cross-tab token-rotation races and brief server hiccups (e.g. handler
  // ran during DB cold-start after `docker compose up --build`). Real
  // expiry still surfaces the banner — just gracePeriodMs later.

  it('retries refresh once after a brief delay on definitive 401, succeeds the second time', async () => {
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      // First refresh attempt — definitive 401.
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }))
      // Second refresh attempt (after grace period) — succeeds.
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { access_token: 'fresh' } }), {
          status: 200
        })
      )
      // Retry of original request with the fresh token.
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      gracePeriodMs: 100
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(200);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(storage.getAccessToken()).toBe('fresh');

    // Two refresh calls (initial + retry).
    const refreshCalls = fetchImpl.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(2);
  });

  it('still calls onSessionExpired when both refresh attempts return 401', async () => {
    // Regression guard: grace period must not hide actually-expired sessions
    // beyond the bounded delay.
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      gracePeriodMs: 50
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledOnce();

    const refreshCalls = fetchImpl.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(2);
  });

  it('does not retry when the first refresh failure is transient (5xx propagates immediately)', async () => {
    // Transient failures already have their own retry mechanism in the
    // sync layer — they must not eat the grace-period retry budget too.
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      gracePeriodMs: 50
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(401);
    expect(onSessionExpired).not.toHaveBeenCalled();

    // Only the first refresh attempt — no retry on transient.
    const refreshCalls = fetchImpl.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
  });

  it('first refresh 401, grace retry 429 → still calls onSessionExpired (definitive wins over transient)', async () => {
    // Regression guard: when attempt #1 returns a definitive 401 but the
    // grace retry hits a transient failure (rate-limit, brief 5xx, network),
    // trust the first definitive answer. Grace period must hide false-
    // positive expiry, never convert real expiry into a transient error.
    // Symptom before fix: refresh_token cookie deleted + sync cascade pushed
    // the per-IP refresh limiter past 60/15min — the grace retry hit 429,
    // throw bubbled up, banner stayed hidden.
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }))
      .mockResolvedValueOnce(new Response('too many', { status: 429 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      gracePeriodMs: 50
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledOnce();

    const refreshCalls = fetchImpl.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(2);
  });

  it('first refresh 401, grace retry 502 → still calls onSessionExpired (same rule applies to 5xx)', async () => {
    // Same as the 429 case above, but for 5xx — covers nginx returning 502
    // during a server rebuild simultaneously with a real session expiry.
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }))
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      gracePeriodMs: 50
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it('grace period can be disabled with gracePeriodMs: 0 (immediate banner on 401)', async () => {
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }));

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      gracePeriodMs: 0
    });

    const response = await authFetch('/api/things');

    expect(response.status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledOnce();

    const refreshCalls = fetchImpl.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
  });

  it('uses storage token if another tab refreshes during the grace period', async () => {
    // While we wait for the grace period, another tab/app may complete a
    // refresh and write the new token to shared storage. The wrapper should
    // detect that and skip its own retry network call.
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/auth/refresh') {
        // Definitive 401 on the only refresh attempt the wrapper should make.
        return Promise.resolve(new Response('refresh denied', { status: 401 }));
      }
      // Original GET retried with the cross-tab token returns 200.
      const tokenHeader = (init?.headers as Headers | undefined)?.get('Authorization');
      if (tokenHeader === 'Bearer fresh-from-other-tab') {
        return Promise.resolve(new Response('ok', { status: 200 }));
      }
      return Promise.resolve(new Response('expired', { status: 401 }));
    });

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      gracePeriodMs: 100
    });

    const pending = authFetch('/api/things');

    // Simulate another tab writing a fresh token mid-grace-period.
    setTimeout(() => storage.setAccessToken('fresh-from-other-tab'), 30);

    const response = await pending;

    expect(response.status).toBe(200); // original request retried with fresh token
    expect(onSessionExpired).not.toHaveBeenCalled();

    const refreshCalls = fetchImpl.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    // Only one refresh call (the first attempt). Retry skipped because
    // storage already has a fresh token.
    expect(refreshCalls).toHaveLength(1);
  });

  // --- Definitive-expiry cache (short-circuits sequential cascades) ---

  it('caches definitive expiry so a sync cascade does not flood /auth/refresh', async () => {
    // Without the cache, sequential 401s on /api/things would each fire up
    // to 2 refresh requests (initial + grace retry). The first refresh
    // definitively confirmed expiry; every subsequent refresh() with the
    // same access_token short-circuits to null with no network call.
    const storage = makeStorage('expired');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/auth/refresh') {
        return Promise.resolve(new Response('refresh denied', { status: 401 }));
      }
      return Promise.resolve(new Response('expired', { status: 401 }));
    });

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      onSessionExpired,
      gracePeriodMs: 50
    });

    await authFetch('/api/things');
    await authFetch('/api/things');
    await authFetch('/api/things');

    const refreshCalls = fetchImpl.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    // First request: 2 refresh attempts (initial + grace retry).
    // Next two requests: 0 refresh attempts — cached null short-circuits.
    expect(refreshCalls).toHaveLength(2);
    expect(onSessionExpired).toHaveBeenCalledTimes(3);
  });

  it('expiry cache survives arbitrarily long without TTL — user idle time does not re-flood refresh', async () => {
    // A user with the banner up may sit idle for minutes before re-auth.
    // Every periodic sync tick, every interaction-triggered request keeps
    // arriving and refresh() must keep short-circuiting on the same token —
    // otherwise the per-IP rate-limiter (60 / 15 min) would be exhausted
    // long before the user gets around to typing their password.
    const storage = makeStorage('expired');
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/auth/refresh') {
        return Promise.resolve(new Response('refresh denied', { status: 401 }));
      }
      return Promise.resolve(new Response('expired', { status: 401 }));
    });

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      gracePeriodMs: 50
    });

    await authFetch('/api/things'); // 2 refresh calls — cache populated
    vi.advanceTimersByTime(10 * 60_000); // 10 minutes of idle
    await authFetch('/api/things'); // still cached — 0 refresh calls

    const refreshCalls = fetchImpl.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(2);
  });

  it('expiry cache is invalidated when access_token changes (post re-auth)', async () => {
    // After the user re-authenticates via the SessionExpiredBanner, a fresh
    // access_token is written to storage. The next refresh() must go to the
    // network (key in the cache no longer matches), not return the stale
    // cached null.
    const storage = makeStorage('expired');
    const fetchImpl = vi
      .fn()
      // request 1: original 401, refresh #1 401, grace retry 401 → cache null
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }))
      // request 2 (after re-auth swaps the token): refresh succeeds
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { access_token: 'fresh' } }), {
          status: 200
        })
      );

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      gracePeriodMs: 50
    });

    await authFetch('/api/things'); // populate cache with null for 'expired'
    storage.setAccessToken('post-reauth-token'); // simulate re-auth via banner
    const refreshed = await authFetch.refresh(); // must go to network

    expect(refreshed).toBe('fresh');
    expect(storage.getAccessToken()).toBe('fresh');
  });

  it('successful refresh clears any stale cached expiry', async () => {
    // If a prior refresh() set the cache, then a later refresh() succeeds
    // (token validity restored e.g. by another tab), the cache must be
    // cleared so further refresh() calls don't return stale null.
    const storage = makeStorage('t1');
    const fetchImpl = vi
      .fn()
      // First refresh cycle: definitive expiry → caches null
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }))
      // After token change + re-auth in storage, refresh() resumes and
      // succeeds → cache cleared
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { access_token: 't2' } }), {
          status: 200
        })
      );

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh',
      storage,
      fetchImpl,
      gracePeriodMs: 50
    });

    expect(await authFetch.refresh()).toBeNull(); // populate cache
    storage.setAccessToken('t2-pre-auth'); // change key so next call isn't short-circuited
    expect(await authFetch.refresh()).toBe('t2'); // success clears cache
  });

  // --- Native mode (refresh token in body + secure storage, no cookie) ---
  //
  // When `refreshTokenStore` is provided (Capacitor shell), the refresh token
  // cannot ride a cross-origin httpOnly cookie, so it is read from secure
  // storage, sent in the POST body, and the rotated token from the response is
  // written back. Web mode (no store) keeps the empty-body + cookie flow.

  it('native mode: sends the stored refresh token in the body and persists the rotated one', async () => {
    const storage = makeStorage('access-old');
    const refreshStore = makeRefreshStore('refresh-old');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { access_token: 'access-new', refresh_token: 'refresh-new' }
        }),
        { status: 200 }
      )
    );

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh-native',
      storage,
      refreshTokenStore: refreshStore,
      fetchImpl
    });

    const newToken = await authFetch.refresh();

    expect(newToken).toBe('access-new');
    expect(storage.getAccessToken()).toBe('access-new');
    // Rotated refresh token persisted for the next refresh.
    expect(refreshStore.get()).toBe('refresh-new');
    // The stored refresh token went out in the body (not a cookie).
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ refresh_token: 'refresh-old' });
  });

  it('native mode: returns null with no network call when no refresh token is stored', async () => {
    const storage = makeStorage('access-old');
    const refreshStore = makeRefreshStore(null);
    const fetchImpl = vi.fn();

    const authFetch = createAuthFetch({
      refreshUrl: '/api/auth/refresh-native',
      storage,
      refreshTokenStore: refreshStore,
      fetchImpl,
      gracePeriodMs: 0
    });

    expect(await authFetch.refresh()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('web mode (no refreshTokenStore): posts an empty body - byte-identical to before', async () => {
    const storage = makeStorage('old');
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { access_token: 'new' } }), {
          status: 200
        })
      );

    const authFetch = createAuthFetch({ refreshUrl: '/api/auth/refresh', storage, fetchImpl });

    await authFetch.refresh();

    expect((fetchImpl.mock.calls[0][1] as RequestInit).body).toBe('{}');
  });
});
