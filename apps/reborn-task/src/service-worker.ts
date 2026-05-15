/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Derive base path from service worker scope (works in both dev and production)
const base = sw.registration?.scope
	? new URL(sw.registration.scope).pathname.replace(/\/$/, '')
	: '';

// Cache names are prefixed with `reborn-task-` so we can isolate them from
// other apps deployed under the same origin (e.g. reborn-notes at /notes).
// The Cache Storage API is per-origin, NOT per-scope — without the prefix,
// each SW would wipe the other app's caches on activate.
const CACHE_PREFIX = 'reborn-task-';
const CACHE = `${CACHE_PREFIX}cache-${version}`;
const ROUTES_CACHE = `${CACHE_PREFIX}routes-${version}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${version}`;

const ASSETS = [
	...build, // the app itself
	...files // everything in `static`
];

// Critical routes to pre-cache (static paths) — prefixed with `base` so the
// pre-cache and pattern matching work under sub-path deployments
// (e.g. PUBLIC_BASE_PATH=/task → routes live at /task/auth/login, not /auth/login).
//
// The full list of main app routes is included so a cold PWA start offline
// (from home-screen icon or deep link) finds a cached HTML shell without
// waiting for network failure.
const CRITICAL_ROUTES = [
	`${base}/`,
	`${base}/auth/login`,
	`${base}/auth/register`,
	`${base}/auth/unlock`,
	`${base}/all`,
	`${base}/today`,
	`${base}/upcoming`,
	`${base}/overdue`,
	`${base}/no-date`,
	`${base}/starred`,
	`${base}/completed`,
	`${base}/trash`,
	`${base}/lists`,
	`${base}/profile`
];

// App-shell key used as SPA fallback for any navigation request whose exact
// URL isn't cached. SvelteKit's client router takes over once this HTML loads.
const APP_SHELL = `${base}/`;

// Escape regex meta-characters so `base` can be safely interpolated into a pattern.
const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Patterns for dynamic routes that should be cached — base-aware.
const DYNAMIC_ROUTE_PATTERNS = [
	new RegExp(`^${escapedBase}/lists/[^/]+$`), // /lists/:listId
	new RegExp(`^${escapedBase}/tasks/[^/]+$`) // /tasks/:taskId
];

// Minimal offline HTML shown when even the app shell is missing from cache
// (e.g. first install happened offline). Plain HTML + inline CSS so it does
// not require a CSP nonce. Reload button triggers a normal navigation which
// will retry the fetch handler.
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><title>Offline — re/task</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;font-family:system-ui;background:#f9fafb;color:#374151;display:flex;align-items:center;justify-content:center}
.box{max-width:320px;text-align:center;padding:24px}
h1{font-size:18px;margin:0 0 8px;font-weight:600}
p{font-size:14px;line-height:1.5;margin:0 0 16px;color:#6b7280}
button{appearance:none;border:0;border-radius:8px;padding:10px 16px;background:#43a047;color:#fff;font-size:14px;font-weight:500;cursor:pointer}
@media (prefers-color-scheme: dark){html,body{background:#252525;color:#e5e7eb}p{color:#a3a3a3}}
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

// Install service worker
sw.addEventListener('install', (event) => {
	// Create a new cache and add all files to it
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

		// Pre-cache critical routes
		const routesCache = await caches.open(ROUTES_CACHE);
		// Try to pre-cache critical routes
		const criticalPromises = CRITICAL_ROUTES.map(async (route) => {
			try {
				const response = await fetch(route);
				if (response.ok) {
					await routesCache.put(route, response);
				}
			} catch {
				console.warn(`Failed to pre-cache route: ${route}`);
			}
		});

		await Promise.all(criticalPromises);
	}

	event.waitUntil(addFilesToCache());
	// Force immediate activation
	sw.skipWaiting();
});

// Activate service worker
sw.addEventListener('activate', (event) => {
	// Remove previous cached data from disk — but ONLY caches owned by this app.
	// Cache Storage is per-origin, so iterating without the prefix filter would
	// wipe out other apps' caches (e.g. reborn-notes) on every activation.
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (!key.startsWith(CACHE_PREFIX)) continue;
			if (key !== CACHE && key !== ROUTES_CACHE && key !== RUNTIME_CACHE) {
				await caches.delete(key);
			}
		}
	}

	event.waitUntil(deleteOldCaches());
	// Take control of all clients immediately
	sw.clients.claim();
});

// Fetch handler
sw.addEventListener('fetch', (event) => {
	// Ignore POST requests etc
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

		// `build`/`files` can always be served from the cache
		if (ASSETS.includes(url.pathname)) {
			const cachedResponse = await cache.match(url.pathname);
			if (cachedResponse) {
				return cachedResponse;
			}
			// Cross-cache fallback: asset may have been cached at runtime
			const runtimeFallback = await (await caches.open(RUNTIME_CACHE)).match(url.pathname);
			if (runtimeFallback) {
				return runtimeFallback;
			}
		}

		// Check if this is a critical route
		const isCriticalRoute = CRITICAL_ROUTES.includes(url.pathname);

		// Check if this matches a dynamic route pattern
		const isDynamicRoute = DYNAMIC_ROUTE_PATTERNS.some((pattern) => pattern.test(url.pathname));

		// Navigation requests: cache-first with SPA app-shell fallback.
		//
		// We flipped from "network-first with cache fallback" because the old
		// strategy blocked offline cold start — mobile browsers wait 30+ s for
		// `fetch()` to reject before the fallback ran, producing the multi-second
		// splash screen users saw in airplane mode. Cache-first returns the shell
		// immediately and refreshes in the background (stale-while-revalidate).
		if (event.request.mode === 'navigate' || isCriticalRoute || isDynamicRoute) {
			const routesCache = await caches.open(ROUTES_CACHE);

			// 1. Exact URL cached → return immediately, refresh in background.
			const cachedExact = await routesCache.match(event.request);
			if (cachedExact) {
				event.waitUntil(refreshInBackground(routesCache, event.request));
				return cachedExact;
			}

			// 2. SPA fallback — any cached app-shell HTML. SvelteKit's client
			//    router takes over after hydration and resolves the real route.
			const shell = await routesCache.match(APP_SHELL);
			if (shell) {
				// Still try to populate this specific URL in the background so
				// subsequent visits get a perfect match.
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

		if (
			url.pathname.startsWith('/_app/') ||
			url.pathname.includes('.js') ||
			url.pathname.includes('.css')
		) {
			// Application code: Stale while revalidate
			const runtimeCache = await caches.open(RUNTIME_CACHE);
			const cachedResponse = await runtimeCache.match(event.request);

			// Return cached version immediately if available
			if (cachedResponse) {
				// Update cache in background (timeout-bounded, silent on failure)
				event.waitUntil(refreshInBackground(runtimeCache, event.request));
				return cachedResponse;
			}

			// No cache, fetch from network with a timeout
			try {
				const response = await fetchWithTimeout(event.request, 3000);

				if (response.ok) {
					runtimeCache.put(event.request, response.clone()).catch(() => {});
				}

				return response;
			} catch {
				// Network failed — cross-cache fallback: check build assets cache
				const buildFallback = await cache.match(url.pathname);
				if (buildFallback) {
					return buildFallback;
				}
				return new Response('Not found', { status: 404 });
			}
		}

		// Other resources: Try network with a timeout, fall back to cache
		try {
			const response = await fetchWithTimeout(event.request, 3000);

			if (response.ok) {
				cache.put(event.request, response.clone()).catch(() => {});
			}

			return response;
		} catch {
			const cachedResponse = await cache.match(event.request);
			if (cachedResponse) {
				return cachedResponse;
			}
		}

		// SvelteKit fetches `__data.json` for any route that has a server load.
		// Offline, we can't reach the server; returning 404 makes SvelteKit
		// render its own 404 page, producing a broken offline cold start.
		// Respond with an empty server-data payload so the universal load
		// (`+layout.ts` / `+page.ts`) still runs and the client router can
		// take over. The shape matches SvelteKit's on-the-wire format for a
		// route with no server data.
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

// ---- Push Notifications ----

interface ScheduledNotification {
	taskId: string;
	title: string;
	body: string;
	fireAt: number; // timestamp ms
	url: string;
}

// In-memory map: taskId → ScheduledNotification
//
// NOTE: We intentionally avoid `setTimeout(delay)` per task — the browser
// terminates idle service workers after ~30 seconds, so any long-lived
// timeouts would be silently lost. Instead, we keep a map of pending
// notifications and a single short-interval poll (`checkNotifications`) that
// fires whichever ones are due. The poll interval (30 s) is short enough to
// stay inside the SW lifecycle, and the main thread re-pushes the schedule
// on `visibilitychange` / a 15-minute timer to recover after the SW is killed.
const scheduledNotifications = new Map<string, ScheduledNotification>();
let checkIntervalId: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 30_000;

function ensureCheckInterval(): void {
	if (checkIntervalId !== null) return;
	checkIntervalId = setInterval(checkNotifications, CHECK_INTERVAL_MS);
}

function stopCheckInterval(): void {
	if (checkIntervalId === null) return;
	clearInterval(checkIntervalId);
	checkIntervalId = null;
}

function checkNotifications(): void {
	const now = Date.now();
	for (const [taskId, notification] of scheduledNotifications) {
		if (notification.fireAt <= now) {
			scheduledNotifications.delete(taskId);
			sw.registration.showNotification(notification.title, {
				body: notification.body,
				icon: `${base}/icons/icon-192.png`,
				badge: `${base}/icons/icon-192.png`,
				data: { url: notification.url },
				tag: `task-${taskId}`
			});
		}
	}
	if (scheduledNotifications.size === 0) stopCheckInterval();
}

/**
 * Push event — triggered by server-sent Web Push
 */
sw.addEventListener('push', (event) => {
	if (!event.data) return;

	let payload: { title?: string; body?: string; url?: string } = {};
	try {
		payload = event.data.json();
	} catch {
		payload = { title: 're/task', body: event.data.text() };
	}

	const title = payload.title ?? 're/task';
	const options: NotificationOptions = {
		body: payload.body ?? '',
		icon: `${base}/icons/icon-192.png`,
		badge: `${base}/icons/icon-192.png`,
		data: { url: payload.url ?? '/' },
		tag: 'reborn-task-push'
	};

	event.waitUntil(sw.registration.showNotification(title, options));
});

/**
 * Notification click — focus or open the app
 */
sw.addEventListener('notificationclick', (event) => {
	event.notification.close();

	const url: string = (event.notification.data as { url?: string })?.url ?? '/';

	event.waitUntil(
		sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
			for (const client of clientList) {
				if (client.url.includes(self.location.origin) && 'focus' in client) {
					client.navigate(url);
					return client.focus();
				}
			}
			return sw.clients.openWindow(url);
		})
	);
});

/**
 * Message handler — schedule/cancel local notifications from the app
 */
sw.addEventListener('message', (event) => {
	const data = event.data as
		| { type: 'SCHEDULE_NOTIFICATION'; notification: ScheduledNotification }
		| { type: 'CANCEL_NOTIFICATION'; taskId: string }
		| { type: 'CANCEL_ALL_NOTIFICATIONS' }
		| { type: 'SHOW_TEST_NOTIFICATION' };

	if (!data?.type) return;

	if (data.type === 'SCHEDULE_NOTIFICATION') {
		const { notification } = data;
		if (notification.fireAt <= Date.now()) return; // already past
		scheduledNotifications.set(notification.taskId, notification);
		ensureCheckInterval();
	} else if (data.type === 'CANCEL_NOTIFICATION') {
		scheduledNotifications.delete(data.taskId);
		if (scheduledNotifications.size === 0) stopCheckInterval();
	} else if (data.type === 'CANCEL_ALL_NOTIFICATIONS') {
		scheduledNotifications.clear();
		stopCheckInterval();
	} else if (data.type === 'SHOW_TEST_NOTIFICATION') {
		event.waitUntil(
			sw.registration.showNotification('re/task', {
				body: 'Testowe powiadomienie — pipeline działa poprawnie.',
				icon: `${base}/icons/icon-192.png`,
				badge: `${base}/icons/icon-192.png`,
				data: { url: '/' },
				tag: 'reborn-task-test'
			})
		);
	}
});
