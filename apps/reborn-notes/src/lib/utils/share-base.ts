import { base } from '$app/paths';
import { env } from '$env/dynamic/public';

/**
 * Public web origin + prefix used to build shareable links (`/s/<slug>#k=...`).
 *
 * - **Web:** `${window.location.origin}${base}` - byte-identical to the inline
 *   `${origin}${base}` the share call-sites used before this helper. On web the
 *   page is already served from the public origin, so that is the right base.
 * - **Native (Capacitor):** the webview serves its own assets from a LOCAL
 *   scheme (`https://localhost`, see `androidScheme` in capacitor.config.ts), so
 *   `window.location.origin` is a local origin - a link nobody else can
 *   open. Derive the PUBLIC web base from `PUBLIC_API_BASE_URL` (set by the
 *   `build-native*` targets, e.g. `https://reapps.eu/notes/api`) by dropping the
 *   trailing `/api`, giving `https://reapps.eu/notes`. Same single source of
 *   truth as `API_BASE`.
 *
 * `$env/dynamic/public` returns `undefined` for an unset var, and the web build
 * never sets `PUBLIC_API_BASE_URL`, so web falls through to the origin path.
 *
 * A function (not a const) so the web branch reads `window.location.origin`
 * lazily at call time - it is only ever called from client-side share flows.
 */
export function getShareBase(): string {
  const apiBase = env.PUBLIC_API_BASE_URL;
  if (apiBase) return apiBase.replace(/\/api\/?$/, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${base}`;
}
