import { env } from '$env/dynamic/public';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * Dynamic PWA manifest.
 *
 * Using a server route instead of a static file so that `start_url` and `scope`
 * can be configured via PUBLIC_BASE_PATH at build/runtime time.
 *
 * Deployment examples:
 *   dev  (port 4200): PUBLIC_BASE_PATH=""  → start_url: "/"
 *   prod (same-origin): PUBLIC_BASE_PATH="/task" → start_url: "/task"
 */
// Bump when icon files change to bypass browser HTTP cache and Android
// adaptive-icon cache. Keep in sync with the value in `src/app.html`.
const ICON_VERSION = '2026-04-26';

export const GET: RequestHandler = () => {
	const base = env.PUBLIC_BASE_PATH ?? '';
	const v = `?v=${ICON_VERSION}`;

	const manifest = {
		name: 're/task',
		short_name: 're/task',
		description: 'Zero-knowledge task management with end-to-end encryption',
		start_url: base ? `${base}/` : '/',
		scope: base ? `${base}/` : '/',
		display: 'standalone',
		// Route in-scope URLs (notification clicks, deep links) to the installed
		// PWA window instead of a browser tab. Without this, Android Chrome opens
		// `clients.openWindow(url)` from the notificationclick handler in a regular
		// browser tab even when the PWA is installed.
		// `navigate-existing`: focus & navigate an open PWA window if any.
		// `handle_links: preferred`: when no PWA window is open, prefer launching
		// the PWA over the browser for URLs within scope. Chromium >= 102 / 96.
		launch_handler: { client_mode: 'navigate-existing' },
		handle_links: 'preferred',
		background_color: '#ffffff',
		theme_color: '#43a047',
		orientation: 'portrait-primary',
		lang: 'pl',
		icons: [
			{
				src: `${base}/icons/icon-192.png${v}`,
				sizes: '192x192',
				type: 'image/png',
				purpose: 'any'
			},
			{
				src: `${base}/icons/icon-512.png${v}`,
				sizes: '512x512',
				type: 'image/png',
				purpose: 'any'
			},
			{
				src: `${base}/icons/icon-512-maskable.png${v}`,
				sizes: '512x512',
				type: 'image/png',
				purpose: 'maskable'
			},
			{
				src: `${base}/favicon.svg${v}`,
				sizes: 'any',
				type: 'image/svg+xml'
			}
		]
	};

	return new Response(JSON.stringify(manifest, null, 2), {
		headers: {
			'Content-Type': 'application/manifest+json',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
