/**
 * Map an inbound public-share deep link to its in-app route.
 *
 * Android App Links deliver the PUBLIC url, e.g.
 *   https://reapps.eu/notes/s/<slug>#k=...&v=1
 * The native build serves its own routes from the scheme root (`base` is '' on
 * native), so we strip everything up to `/s/` and rebuild the in-app path while
 * KEEPING the fragment.
 *
 * Zero-Knowledge: the `#k=...` fragment carries the per-share decryption key.
 * It must stay client-side - we route with it via `goto` (a client navigation),
 * never send it to the server, and never log the URL. This mirrors how the web
 * public page already reads the key from `window.location.hash`.
 *
 * Returns null for anything that is not a `/s/<slug>` share link, so the caller
 * ignores unrelated deep links instead of navigating somewhere wrong.
 */
export function shareDeepLinkToRoute(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  // `/s/<slug>` as the final path segment. The public path may be prefixed
  // (e.g. `/notes/s/<slug>`); we only care about the slug + fragment.
  const match = url.pathname.match(/\/s\/([^/]+)\/?$/);
  if (!match) return null;
  // base is '' on the native build (the only place this runs), so the in-app
  // route is just `/s/<slug>` plus the original fragment.
  return `/s/${match[1]}${url.hash}`;
}
