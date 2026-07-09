/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Derive base path from service worker scope (works in both dev and production)
const base = sw.registration?.scope ? new URL(sw.registration.scope).pathname.replace(/\/$/, '') : '';

// Cache names are prefixed with `reborn-notes-` so we can isolate them from
// other apps deployed under the same origin (e.g. reborn-task at /task).
// The Cache Storage API is per-origin, NOT per-scope — without the prefix,
// each SW would wipe the other app's caches on activate.
const CACHE_PREFIX = 'reborn-notes-';
const CACHE = `${CACHE_PREFIX}cache-${version}`;
const ROUTES_CACHE = `${CACHE_PREFIX}routes-${version}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${version}`;

// All static assets to pre-cache
const ASSETS = [...build, ...files];

// Critical routes to pre-cache for offline support — prefixed with `base`
// so the list survives sub-path deployments (e.g. PUBLIC_BASE_PATH=/notes).
const CRITICAL_ROUTES = [
  `${base}/`,
  `${base}/auth/login`,
  `${base}/auth/register`,
  `${base}/auth/unlock`,
  `${base}/auth/2fa`
];

// App-shell key used as SPA fallback for any navigation request whose exact
// URL isn't cached. SvelteKit's client router takes over once this HTML loads.
const APP_SHELL = `${base}/`;

// Minimal offline HTML shown when even the app shell is missing from cache
// (e.g. first install happened offline). Plain HTML + inline CSS so it does
// not require a CSP nonce. Reload button triggers a normal navigation which
// will retry the fetch handler.
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><title>Offline — re/notes</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;font-family:system-ui;background:#ffffff;color:#374151;display:flex;align-items:center;justify-content:center}
.box{max-width:320px;text-align:center;padding:24px}
h1{font-size:18px;margin:0 0 8px;font-weight:600}
p{font-size:14px;line-height:1.5;margin:0 0 16px;color:#6b7280}
button{appearance:none;border:0;border-radius:8px;padding:10px 16px;background:#fbc02d;color:#1f2937;font-size:14px;font-weight:500;cursor:pointer}
@media (prefers-color-scheme: dark){html,body{background:#0a0a0a;color:#e5e7eb}p{color:#a3a3a3}}
</style></head><body><div class="box"><h1>Brak połączenia</h1>
<p>Ta strona nie została jeszcze zapisana w pamięci podręcznej aplikacji. Połącz się z siecią i spróbuj ponownie.</p>
<button onclick="location.reload()">Spróbuj ponownie</button></div></body></html>`;

const OFFLINE_RESPONSE = () =>
  new Response(OFFLINE_HTML, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });

// Race a network fetch against a short timeout so slow/airplane-mode requests
// don't block the service worker while the OS waits for DNS/TCP to time out
// (30+ seconds on mobile). Rejects on timeout, letting callers fall back to
// cache immediately.
async function fetchWithTimeout(request: Request, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Background refresh for stale-while-revalidate — never throws.
function refreshInBackground(cache: Cache, request: Request, timeoutMs = 5000): Promise<void> {
  return fetchWithTimeout(request, timeoutMs)
    .then((response) => {
      if (response.ok) return cache.put(request, response.clone()).catch(() => {});
    })
    .catch(() => {
      /* best-effort refresh — silent on failure */
    });
}

// ── Install ──────────────────────────────────────────────────────────────────

sw.addEventListener('install', (event) => {
  async function addFilesToCache() {
    const cache = await caches.open(CACHE);
    // Resilient install: cache each asset individually so a single
    // failure doesn't prevent the rest from being cached.
    await Promise.all(
      ASSETS.map(async (asset) => {
        try {
          await cache.add(asset);
        } catch {
          console.warn(`Failed to pre-cache asset: ${asset}`);
        }
      })
    );
    const routesCache = await caches.open(ROUTES_CACHE);
    await Promise.all(
      CRITICAL_ROUTES.map(async (route) => {
        try {
          const res = await fetch(route);
          if (res.ok) await routesCache.put(route, res);
        } catch {
          /* offline during install — skip */
        }
      })
    );
  }
  event.waitUntil(addFilesToCache());
  sw.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────

sw.addEventListener('activate', (event) => {
  // Remove previous cached data from disk — but ONLY caches owned by this app.
  // Cache Storage is per-origin, so iterating without the prefix filter would
  // wipe out other apps' caches (e.g. reborn-task) on every activation.
  async function deleteOldCaches() {
    for (const key of await caches.keys()) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      if (key !== CACHE && key !== ROUTES_CACHE && key !== RUNTIME_CACHE) {
        await caches.delete(key);
      }
    }
  }
  event.waitUntil(deleteOldCaches());
  sw.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

sw.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Public read-only share routes (`${base}/s/<slug>`) and their API endpoint
  // (`${base}/api/shares/<slug>`) are capability URLs that must always go to
  // the network: max_access_count enforcement and revocation must reflect the
  // server's current state on every open, so serving any cached response here
  // would defeat the access-count gate and let revoked shares keep opening.
  const sharePath = `${base}/s/`;
  const shareApiPath = `${base}/api/shares/`;
  const reqUrl = new URL(event.request.url);
  if (reqUrl.pathname.startsWith(sharePath) || reqUrl.pathname.startsWith(shareApiPath)) {
    return;
  }

  async function respond() {
    const url = new URL(event.request.url);
    const cache = await caches.open(CACHE);

    // Static assets (build output + static files) — cache first
    if (ASSETS.includes(url.pathname)) {
      const cached = await cache.match(url.pathname);
      if (cached) return cached;
      // Cross-cache fallback: asset may have been cached at runtime
      const runtimeFallback = await (await caches.open(RUNTIME_CACHE)).match(url.pathname);
      if (runtimeFallback) return runtimeFallback;
    }

    // Navigation requests — cache-first with SPA app-shell fallback.
    //
    // The previous "network-first" strategy blocked offline cold start in
    // airplane mode because mobile browsers wait 30+ s for `fetch()` to
    // reject before the cache fallback ran. Cache-first returns the shell
    // immediately; a background refresh keeps content fresh when online
    // (stale-while-revalidate).
    if (event.request.mode === 'navigate') {
      const routesCache = await caches.open(ROUTES_CACHE);

      // 1. Exact URL cached → return immediately, refresh in background.
      const cachedExact = await routesCache.match(event.request);
      if (cachedExact) {
        event.waitUntil(refreshInBackground(routesCache, event.request));
        return cachedExact;
      }

      // 2. SPA fallback — cached app-shell HTML. SvelteKit's client router
      //    takes over after hydration and resolves the real route.
      const shell = await routesCache.match(APP_SHELL);
      if (shell) {
        event.waitUntil(refreshInBackground(routesCache, event.request));
        return shell;
      }

      // 3. No cached shell — try network with a short timeout so we don't
      //    hang on a stale DNS lookup.
      try {
        const response = await fetchWithTimeout(event.request, 3000);
        if (response.ok) {
          routesCache.put(event.request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        // 4. Absolute last resort — minimal inline offline page.
        return OFFLINE_RESPONSE();
      }
    }

    // App JS/CSS — stale-while-revalidate
    if (url.pathname.startsWith('/_app/') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
      const runtimeCache = await caches.open(RUNTIME_CACHE);
      const cached = await runtimeCache.match(event.request);
      if (cached) {
        event.waitUntil(refreshInBackground(runtimeCache, event.request));
        return cached;
      }
      try {
        const response = await fetchWithTimeout(event.request, 3000);
        if (response.ok) runtimeCache.put(event.request, response.clone()).catch(() => {});
        return response;
      } catch {
        // Network failed — cross-cache fallback: check build assets cache
        const buildFallback = await cache.match(url.pathname);
        if (buildFallback) return buildFallback;
        return new Response('Not found', { status: 404 });
      }
    }

    // Everything else — network with a timeout, fall back to cache
    try {
      const response = await fetchWithTimeout(event.request, 3000);
      if (response.ok) cache.put(event.request, response.clone()).catch(() => {});
      return response;
    } catch {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }

    // SvelteKit fetches `__data.json` for any route that has a server load.
    // Offline, we can't reach the server; returning 404 makes SvelteKit
    // render its own 404 page. Respond with an empty server-data payload so
    // the universal load still runs and the client router can take over.
    if (url.pathname.endsWith('/__data.json') || url.pathname.endsWith('__data.json')) {
      return new Response(JSON.stringify({ type: 'data', nodes: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }

  event.respondWith(respond());
});
