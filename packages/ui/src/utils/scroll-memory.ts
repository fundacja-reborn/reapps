/**
 * Scroll position of a page that scrolls inside its own container, kept while
 * the user visits one of its sub-pages (#540).
 *
 * SvelteKit restores only the window scroll, and only on history navigation.
 * The settings pages scroll inside a full-height container and their back
 * arrow is a plain link, so without this the settings hub jumped to the top
 * every time the user came back from a sub-page.
 *
 * Rules:
 * - leaving a page for one of its sub-pages (`/settings` to
 *   `/settings/appearance`) remembers the position;
 * - arriving back from a sub-page (link, `goto()` or the browser's back
 *   button) hands the position back, once;
 * - any other way in or out forgets it, so opening the page from the app
 *   starts at the top.
 *
 * The memory lives for the lifetime of the tab. No navigation imports here, so
 * the rules stay testable; components wire it to `beforeNavigate` and
 * `afterNavigate`.
 */

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** True when `candidate` is a route below `parent` (not the same route). */
export function isSubPath(parent: string, candidate: string): boolean {
  const base = trimTrailingSlash(parent);
  const path = trimTrailingSlash(candidate);
  if (base === '/') return path !== '/';
  return path.startsWith(`${base}/`);
}

export interface ScrollMemory {
  /** Call before navigating away from `fromPath`. */
  leave(fromPath: string, toPath: string | undefined, scrollTop: number | undefined): void;
  /** Call after arriving at `toPath`. Returns the position to restore, if any. */
  arrive(toPath: string, fromPath: string | undefined): number | undefined;
}

export function createScrollMemory(): ScrollMemory {
  const saved = new Map<string, number>();

  return {
    leave(fromPath, toPath, scrollTop) {
      const here = trimTrailingSlash(fromPath);
      if (toPath !== undefined && scrollTop !== undefined && isSubPath(here, toPath)) {
        saved.set(here, scrollTop);
      } else {
        saved.delete(here);
      }
    },

    arrive(toPath, fromPath) {
      const here = trimTrailingSlash(toPath);
      const top = saved.get(here);
      saved.delete(here);
      if (top === undefined || fromPath === undefined || !isSubPath(here, fromPath)) {
        return undefined;
      }
      return top;
    }
  };
}

/** Shared by every page of the app that opts in. */
export const scrollMemory = createScrollMemory();
