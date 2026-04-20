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

// Critical routes to pre-cache for offline support
const CRITICAL_ROUTES = [`${base}/`, `${base}/auth/login`, `${base}/auth/unlock`];

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
        } catch { /* offline during install — skip */ }
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

    // Navigation requests — network first, fall back to cached shell
    if (event.request.mode === 'navigate') {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const routesCache = await caches.open(ROUTES_CACHE);
          routesCache.put(event.request, response.clone());
        }
        return response;
      } catch {
        const routesCache = await caches.open(ROUTES_CACHE);
        const cached = await routesCache.match(event.request);
        if (cached) return cached;
        // Fall back to the app shell
        const shell = await cache.match('/') ?? await cache.match(url.origin + '/');
        if (shell) return shell;
      }
    }

    // App JS/CSS — stale-while-revalidate
    if (url.pathname.startsWith('/_app/') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
      const runtimeCache = await caches.open(RUNTIME_CACHE);
      const cached = await runtimeCache.match(event.request);
      if (cached) {
        // fire-and-forget: cache storage is best-effort
        fetch(event.request).then((r) => { if (r.ok) runtimeCache.put(event.request, r); }).catch(() => {});
        return cached;
      }
      try {
        const response = await fetch(event.request);
        if (response.ok) runtimeCache.put(event.request, response.clone());
        return response;
      } catch {
        // Network failed — cross-cache fallback: check build assets cache
        const buildFallback = await cache.match(url.pathname);
        if (buildFallback) return buildFallback;
        return new Response('Not found', { status: 404 });
      }
    }

    // Everything else — network with cache fallback
    try {
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }

    return new Response('Not found', { status: 404 });
  }

  event.respondWith(respond());
});
