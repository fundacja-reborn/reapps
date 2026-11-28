import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../core/client';

// Minimal browser globals: ApiClient reads `navigator.onLine`, AuthInterceptor
// reads `localStorage`, and the constructor registers listeners on `window`.
function ensureBrowserGlobals() {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.navigator === 'undefined') {
    g.navigator = { onLine: true };
  } else {
    (g.navigator as { onLine?: boolean }).onLine = true;
  }
  if (typeof g.localStorage === 'undefined') {
    const store = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0
    };
  }
  if (typeof g.window === 'undefined') {
    g.window = {
      localStorage: g.localStorage,
      addEventListener: () => {/* no-op test stub */},
      removeEventListener: () => {/* no-op test stub */}
    };
  }
}

const LISTS = [{ id: 'l1', name_encrypted: 'iv:ct', is_default: true }];

describe('ApiClient - response parsing', () => {
  beforeEach(() => {
    ensureBrowserGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the body even when Content-Length says 0 (Android WebView intercepted GET)', async () => {
    // What the native shell hands the page: WebView derives Content-Length
    // from the stream's bytes-available count (0 for a network stream), the
    // body itself is complete.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: LISTS }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Length': '0' }
        })
      )
    );

    const client = new ApiClient({ baseUrl: 'https://example.test/task/api' });
    const res = await client.get<typeof LISTS>('tasklists');

    expect(res.success).toBe(true);
    expect(res.data).toEqual(LISTS);
  });

  it('keeps a 204 as success without data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const client = new ApiClient({ baseUrl: 'https://example.test/task/api' });
    const res = await client.delete('tasklists/l1');

    expect(res.success).toBe(true);
    expect(res.data).toBeUndefined();
  });

  it('treats a truly empty 200 body as success without data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const client = new ApiClient({ baseUrl: 'https://example.test/task/api' });
    const res = await client.get('tasklists');

    expect(res.success).toBe(true);
    expect(res.data).toBeUndefined();
  });
});
