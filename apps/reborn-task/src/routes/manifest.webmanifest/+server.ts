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
export const GET: RequestHandler = () => {
	const base = env.PUBLIC_BASE_PATH ?? '';

	const manifest = {
		name: 're/task',
		short_name: 're/task',
		description: 'Zero-knowledge task management with end-to-end encryption',
		start_url: base ? `${base}/` : '/',
		scope: base ? `${base}/` : '/',
		display: 'standalone',
		background_color: '#ffffff',
		theme_color: '#43a047',
		orientation: 'portrait-primary',
		lang: 'pl',
		icons: [
			{
				src: `${base}/icons/icon-192.png`,
				sizes: '192x192',
				type: 'image/png'
			},
			{
				src: `${base}/icons/icon-512.png`,
				sizes: '512x512',
				type: 'image/png'
			},
			{
				src: `${base}/icons/icon-512-maskable.png`,
				sizes: '512x512',
				type: 'image/png',
				purpose: 'maskable'
			},
			{
				src: `${base}/favicon.svg`,
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
