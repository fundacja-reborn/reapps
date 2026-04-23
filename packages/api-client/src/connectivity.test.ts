import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeOnline } from './connectivity';

describe('probeOnline', () => {
  const endpoint = 'https://example.test/api/health';
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns true on 2xx HEAD', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(probeOnline(endpoint)).resolves.toBe(true);
  });

  it('returns false on 5xx HEAD', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(probeOnline(endpoint)).resolves.toBe(false);
  });

  it('falls back to GET on 405 HEAD and respects its result', async () => {
    const fetchSpy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 405 });
      return new Response('ok', { status: 200 });
    });
    globalThis.fetch = fetchSpy;
    await expect(probeOnline(endpoint)).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns false when fetch rejects (network / DNS / VPN black hole)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(probeOnline(endpoint)).resolves.toBe(false);
  });

  it('returns false on AbortError (timeout)', async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(probeOnline(endpoint, 100)).resolves.toBe(false);
  });

  it('omits credentials to avoid hot cookies', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchSpy;
    await probeOnline(endpoint);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
  });
});
