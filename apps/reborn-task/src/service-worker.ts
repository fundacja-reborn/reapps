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
const CRITICAL_ROUTES = [
	`${base}/`,
	`${base}/auth/login`,
	`${base}/auth/register`,
	`${base}/auth/unlock`
];

// Escape regex meta-characters so `base` can be safely interpolated into a pattern.
const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Patterns for dynamic routes that should be cached — base-aware.
const DYNAMIC_ROUTE_PATTERNS = [
	new RegExp(`^${escapedBase}/lists/[^/]+$`), // /lists/:listId
	new RegExp(`^${escapedBase}/tasks/[^/]+$`) // /tasks/:taskId
];

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

		// Determine caching strategy based on request type
		if (event.request.mode === 'navigate' || isCriticalRoute || isDynamicRoute) {
			// Navigation requests: Network first with cache fallback
			try {
				const response = await fetch(event.request);

				if (response.ok) {
					const routesCache = await caches.open(ROUTES_CACHE);
					routesCache.put(event.request, response.clone());
				}

				return response;
			} catch {
				// Network failed, try cache
				const routesCache = await caches.open(ROUTES_CACHE);
				const cachedResponse = await routesCache.match(event.request);

				if (cachedResponse) {
					return cachedResponse;
				}

				// Try to return the app shell for navigation requests
				if (event.request.mode === 'navigate') {
					const appShell = await cache.match('/');
					if (appShell) {
						return appShell;
					}
				}
			}
		} else if (
			url.pathname.startsWith('/_app/') ||
			url.pathname.includes('.js') ||
			url.pathname.includes('.css')
		) {
			// Application code: Stale while revalidate
			const runtimeCache = await caches.open(RUNTIME_CACHE);
			const cachedResponse = await runtimeCache.match(event.request);

			// Return cached version immediately if available
			if (cachedResponse) {
				// Update cache in background
				// fire-and-forget: cache storage is best-effort
				fetch(event.request)
					.then((response) => {
						if (response.ok) {
							runtimeCache.put(event.request, response);
						}
					})
					// fire-and-forget: cache storage is best-effort
					.catch(() => {});

				return cachedResponse;
			}

			// No cache, fetch from network
			try {
				const response = await fetch(event.request);

				if (response.ok) {
					runtimeCache.put(event.request, response.clone());
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
		} else {
			// Other resources: Try network first, fall back to cache
			try {
				const response = await fetch(event.request);

				if (response.ok) {
					cache.put(event.request, response.clone());
				}

				return response;
			} catch {
				const cachedResponse = await cache.match(event.request);
				if (cachedResponse) {
					return cachedResponse;
				}
			}
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
