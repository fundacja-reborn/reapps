/**
 * Routing rules of the desktop (Tauri) HTTP transport: which requests leave
 * through the shell's HTTP plugin and which stay on the webview's own fetch.
 * A wrong answer either breaks every API call (CORS) or sends a bundled-asset
 * request to a plugin that will refuse it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installDesktopFetch, isCrossOriginHttp, requestUrl } from './desktop-fetch';

const MAC_PAGE = 'tauri://localhost/';
const MAC_ORIGIN = 'tauri://localhost';
const WINDOWS_PAGE = 'http://tauri.localhost/';
const WINDOWS_ORIGIN = 'http://tauri.localhost';

describe('requestUrl', () => {
  it('reads the URL from a string, a URL and a Request', () => {
    expect(requestUrl('https://reapps.eu/notes/api/notes')).toBe(
      'https://reapps.eu/notes/api/notes'
    );
    expect(requestUrl(new URL('https://reapps.eu/notes/api/tags'))).toBe(
      'https://reapps.eu/notes/api/tags'
    );
    expect(requestUrl(new Request('https://reapps.eu/notes/api/folders'))).toBe(
      'https://reapps.eu/notes/api/folders'
    );
  });
});

describe('isCrossOriginHttp', () => {
  it('routes the remote API through the shell on macOS', () => {
    expect(isCrossOriginHttp('https://reapps.eu/notes/api/notes', MAC_PAGE, MAC_ORIGIN)).toBe(true);
    expect(isCrossOriginHttp('http://localhost/notes/api/health', MAC_PAGE, MAC_ORIGIN)).toBe(true);
  });

  it('routes the remote API through the shell on Windows', () => {
    expect(
      isCrossOriginHttp('https://reapps.eu/notes/api/notes', WINDOWS_PAGE, WINDOWS_ORIGIN)
    ).toBe(true);
    // The local dev stack is another origin than the shell's own http origin.
    expect(
      isCrossOriginHttp('http://localhost/notes/api/health', WINDOWS_PAGE, WINDOWS_ORIGIN)
    ).toBe(true);
  });

  it('keeps bundled assets on the webview fetch', () => {
    expect(isCrossOriginHttp('/_app/immutable/chunks/a.js', MAC_PAGE, MAC_ORIGIN)).toBe(false);
    expect(isCrossOriginHttp('tauri://localhost/_app/env.js', MAC_PAGE, MAC_ORIGIN)).toBe(false);
    expect(isCrossOriginHttp('/_app/immutable/chunks/a.js', WINDOWS_PAGE, WINDOWS_ORIGIN)).toBe(
      false
    );
    expect(
      isCrossOriginHttp('http://tauri.localhost/_app/env.js', WINDOWS_PAGE, WINDOWS_ORIGIN)
    ).toBe(false);
  });

  it('keeps non-http schemes on the webview fetch', () => {
    expect(isCrossOriginHttp('blob:tauri://localhost/1234', MAC_PAGE, MAC_ORIGIN)).toBe(false);
    expect(isCrossOriginHttp('data:text/plain,hello', MAC_PAGE, MAC_ORIGIN)).toBe(false);
    expect(isCrossOriginHttp('ipc://localhost/secure_storage_get', MAC_PAGE, MAC_ORIGIN)).toBe(
      false
    );
  });

  it('leaves unparsable input to the webview fetch', () => {
    expect(isCrossOriginHttp('http://[broken', MAC_PAGE, MAC_ORIGIN)).toBe(false);
  });
});

describe('installDesktopFetch', () => {
  const originalFetch = globalThis.fetch;
  const globals = globalThis as { location?: unknown; __TAURI__?: unknown };
  const originalLocation = globals.location;

  let webviewFetch: ReturnType<typeof vi.fn>;
  let shellFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    webviewFetch = vi.fn(async () => new Response('webview'));
    shellFetch = vi.fn(async () => new Response('shell'));
    globalThis.fetch = webviewFetch as unknown as typeof fetch;
    globals.location = { href: MAC_PAGE, origin: MAC_ORIGIN };
    globals.__TAURI__ = { core: { invoke: vi.fn() }, http: { fetch: shellFetch } };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globals.location = originalLocation;
    delete globals.__TAURI__;
  });

  it('sends API requests through the shell, with the caller arguments untouched', async () => {
    installDesktopFetch();
    const init = { method: 'POST', body: '{}' };

    const response = await fetch('https://reapps.eu/notes/api/notes', init);

    expect(await response.text()).toBe('shell');
    expect(shellFetch).toHaveBeenCalledWith('https://reapps.eu/notes/api/notes', init);
    expect(webviewFetch).not.toHaveBeenCalled();
  });

  it('leaves bundled assets on the webview fetch', async () => {
    installDesktopFetch();

    const response = await fetch('/_app/env.js');

    expect(await response.text()).toBe('webview');
    expect(shellFetch).not.toHaveBeenCalled();
  });

  it('fails the request clearly when the HTTP plugin is missing', async () => {
    globals.__TAURI__ = { core: { invoke: vi.fn() } };
    installDesktopFetch();

    await expect(fetch('https://reapps.eu/notes/api/notes')).rejects.toThrow(
      'desktop HTTP transport unavailable'
    );
    expect(webviewFetch).not.toHaveBeenCalled();
  });

  it('picks up a plugin that registers after installation', async () => {
    globals.__TAURI__ = { core: { invoke: vi.fn() } };
    installDesktopFetch();
    globals.__TAURI__ = { core: { invoke: vi.fn() }, http: { fetch: shellFetch } };

    const response = await fetch('https://reapps.eu/notes/api/notes');

    expect(await response.text()).toBe('shell');
  });
});
