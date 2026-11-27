/**
 * Map an inbound public-share deep link to its in-app route.
 *
 * Android App Links / iOS Universal Links deliver the PUBLIC url, e.g.
 *   https://reapps.eu/notes/s/<slug>#k=...&v=1  (re/task: /task/s/<slug>)
 * A native build serves its own routes from the scheme root (`base` is '' on
 * native), so we strip everything up to `/s/` and rebuild the in-app path while
 * KEEPING the fragment. Shared by both apps.
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

/** How the native share view's back button leaves the snapshot. */
export type ShareViewExit = 'back' | 'home' | 'reload';

/** True for the in-app share route `/s/<slug>` (any base prefix). */
function isShareViewPath(pathname: string): boolean {
  return /\/s\/[^/]+\/?$/.test(pathname);
}

/**
 * Decide how the native share view's back button leaves the snapshot, from the
 * route the app showed right before it (SvelteKit `afterNavigate` -> `from`).
 *
 * - `'reload'`: the document itself started on the share view (a webview that
 *   reloaded the current URL, e.g. iOS after its content process died). The
 *   boot-time bypass for anonymous viewers (`hooks.client.ts`, `+layout.svelte`)
 *   then skipped storage and auth, so only a full load of the start route boots
 *   the app properly - a client-side `goto` would land in an uninitialised app.
 * - `'back'`: the app was already showing one of its own screens when the link
 *   arrived (a note, Settings, the lock screen). Walking the history returns
 *   the user exactly there, and leaves the webview history in the shape a
 *   hardware BACK leaves it. A cold start from a link lands here too: the shell
 *   boots at its root route before the deep link navigates, so the entry below
 *   is that root - the start of the app.
 * - `'home'`: nothing of the app's own came before - another share view (a
 *   second link opened over the first, which the button must not reopen). The
 *   caller replaces the entry with the start route, where the auth guard shows
 *   the login or lock screen when needed.
 */
export function shareViewExit(
  fromPathname: string | null | undefined,
  bootedOnShareView: boolean
): ShareViewExit {
  if (bootedOnShareView) return 'reload';
  if (!fromPathname || isShareViewPath(fromPathname)) return 'home';
  return 'back';
}
