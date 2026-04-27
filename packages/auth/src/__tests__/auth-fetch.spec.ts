import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthFetch, type AuthFetchTokenStorage } from '../utils/auth-fetch';

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
      onSessionExpired
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
      onSessionExpired
    });

    const newToken = await authFetch.refresh();

    expect(newToken).toBeNull();
    expect(storage.getAccessToken()).toBe('old'); // unchanged
    // refresh() itself does NOT call onSessionExpired — that's the wrapper's job on 401-driven refresh.
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});
