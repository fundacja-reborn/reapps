/**
 * HTTP transport for the desktop (Tauri) shell - the counterpart of
 * CapacitorHttp on mobile.
 *
 * The shell loads the app from a local origin (`tauri://localhost` on macOS,
 * `http://tauri.localhost` on Windows) and talks to the remote API
 * cross-origin. The server sends no CORS headers by design, so the webview's
 * own `fetch` cannot reach it. Requests to another http(s) origin are handed to
 * the shell's HTTP plugin instead, which performs them outside the webview;
 * the shell's capability file (`src-tauri/capabilities/`) is the allowlist of
 * origins it will actually contact. Everything else - bundled assets, `blob:`
 * and `data:` URLs - stays on the webview's fetch.
 *
 * Installed from `hooks.client.ts` before anything can issue a request.
 */

import { getDesktopBridge } from './desktop-bridge';

/** The URL a fetch call targets, whatever form `input` takes. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * True when a request must leave through the shell: an http(s) URL on another
 * origin than the page. Relative URLs resolve against `pageUrl`, so they are
 * same-origin by construction; unparsable input stays on the webview fetch,
 * which reports the error the caller expects.
 */
export function isCrossOriginHttp(url: string, pageUrl: string, pageOrigin: string): boolean {
  let target: URL;
  try {
    target = new URL(url, pageUrl);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
  return target.origin !== pageOrigin;
}

/**
 * Route cross-origin http(s) requests through the shell's HTTP plugin.
 *
 * The plugin is looked up per call, not captured: a missing plugin then fails
 * the one request with a clear error instead of silently falling back to a
 * webview fetch that would die on CORS with a misleading message.
 */
export function installDesktopFetch(): void {
  const webviewFetch = globalThis.fetch.bind(globalThis);
  const pageUrl = globalThis.location.href;
  const pageOrigin = globalThis.location.origin;

  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isCrossOriginHttp(requestUrl(input), pageUrl, pageOrigin)) {
      return webviewFetch(input, init);
    }
    const shellFetch = getDesktopBridge()?.http?.fetch;
    if (!shellFetch) {
      return Promise.reject(new TypeError('desktop HTTP transport unavailable'));
    }
    return shellFetch(input, init);
  };
}
