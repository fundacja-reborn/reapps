import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../core/client';

// In Node 22+ `navigator` and `localStorage` exist; in older runners we need
// to provide minimal shims. The api-client only reads `navigator.onLine` and
// (via AuthInterceptor) `localStorage.access_token` during request().
function ensureBrowserGlobals() {
  if (typeof (globalThis as { navigator?: unknown }).navigator === 'undefined') {
    (globalThis as { navigator: { onLine: boolean } }).navigator = { onLine: true };
  } else {
    (globalThis as { navigator: { onLine?: boolean } }).navigator.onLine = true;
  }

  if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0
    } as Storage;
  }

  // AuthInterceptor checks `typeof window !== 'undefined' && window.localStorage`,
  // and ApiClient registers online/offline listeners on `window` — so we shim
  // both the storage and the addEventListener no-op.
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as {
      window: { localStorage: Storage; addEventListener: () => void; removeEventListener: () => void };
    }).window = {
      localStorage: (globalThis as { localStorage: Storage }).localStorage,
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }
}

describe('ApiClient — 401 refresh + retry', () => {
  beforeEach(() => {
    ensureBrowserGlobals();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries the original request once after onUnauthorized returns "refreshed"', async () => {
    localStorage.setItem('access_token', 'expired');

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const headers = init?.headers;
      const auth =
        headers instanceof Headers
          ? headers.get('Authorization')
          : (headers as Record<string, string> | undefined)?.['Authorization'];
      if (auth === 'Bearer fresh') {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { ok: true } }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }
      return Promise.resolve(new Response('expired', { status: 401 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockImplementation(async () => {
      localStorage.setItem('access_token', 'fresh');
      return 'refreshed' as const;
    });
    const onSessionExpired = vi.fn();

    const client = new ApiClient({ baseUrl: '/api', onUnauthorized, onSessionExpired });
    const res = await client.get<{ ok: boolean }>('/things');

    expect(res.success).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Initial used expired, retry used fresh
    expect(
      (fetchMock.mock.calls[0][1].headers as Record<string, string>)['Authorization']
    ).toBe('Bearer expired');
    expect(
      (fetchMock.mock.calls[1][1].headers as Record<string, string>)['Authorization']
    ).toBe('Bearer fresh');
  });

  it('surfaces 401 AND fires onSessionExpired when onUnauthorized returns "session-expired"', async () => {
    localStorage.setItem('access_token', 'expired');

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      }));
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue('session-expired' as const);
    const onSessionExpired = vi.fn();

    const client = new ApiClient({ baseUrl: '/api', onUnauthorized, onSessionExpired });
    const res = await client.get('/things');

    expect(res.success).toBe(false);
    expect(res.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onSessionExpired).toHaveBeenCalledOnce();
    // No retry — the 401 was definitive.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces 401 WITHOUT firing onSessionExpired when onUnauthorized returns "transient"', async () => {
    localStorage.setItem('access_token', 'expired');

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      }));
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue('transient' as const);
    const onSessionExpired = vi.fn();

    const client = new ApiClient({ baseUrl: '/api', onUnauthorized, onSessionExpired });
    const res = await client.get('/things');

    expect(res.success).toBe(false);
    expect(res.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    // Crucial: transient failures must NOT flip the session-expired banner.
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a thrown onUnauthorized as "transient" (no banner, no retry)', async () => {
    localStorage.setItem('access_token', 'expired');

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: false }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      }));
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockRejectedValue(new Error('boom'));
    const onSessionExpired = vi.fn();

    const client = new ApiClient({ baseUrl: '/api', onUnauthorized, onSessionExpired });
    const res = await client.get('/things');

    expect(res.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onUnauthorized for /auth/refresh itself (no recursive loop)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'expired' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue('session-expired' as const);
    const onSessionExpired = vi.fn();

    const client = new ApiClient({ baseUrl: '/api', onUnauthorized, onSessionExpired });
    await client.post('/auth/refresh', {});

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onUnauthorized when skipAuth is set', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: false }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue('session-expired' as const);
    const onSessionExpired = vi.fn();
    const client = new ApiClient({ baseUrl: '/api', onUnauthorized, onSessionExpired });
    await client.get('/things', { skipAuth: true });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
