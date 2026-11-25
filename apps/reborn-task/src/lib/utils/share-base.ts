import { base } from '$app/paths';
import { env } from '$env/dynamic/public';

/**
 * Public web origin + prefix used to build shareable links (`/s/<slug>#k=...`).
 *
 * - **Web:** `${window.location.origin}${base}` - byte-identical to the inline
 *   `${origin}${base}` the share call sites used before this helper.
 * - **Native (Capacitor):** the webview serves its own assets from a LOCAL
 *   scheme (`https://localhost` / `capacitor://localhost`), so
 *   `window.location.origin` would produce a link nobody else can open. The
 *   public web base is `PUBLIC_API_BASE_URL` (set by the `build-native*`
 *   targets, e.g. `https://reapps.eu/task/api`) without the trailing `/api`.
 *   Same single source of truth as `API_BASE` (helper shared in shape with
 *   re/notes).
 *
 * A function, so the web branch reads `window.location.origin` lazily at call
 * time - it is only ever called from client-side share flows.
 */
export function getShareBase(): string {
	const apiBase = env.PUBLIC_API_BASE_URL;
	if (apiBase) return apiBase.replace(/\/api\/?$/, '');
	const origin = typeof window !== 'undefined' ? window.location.origin : '';
	return `${origin}${base}`;
}
