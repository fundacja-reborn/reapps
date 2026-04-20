import { goto as _goto } from '$app/navigation';
import { base, resolve } from '$app/paths';

// Bypass SvelteKit typed routes — resolve() expects route literals but we use dynamic strings
const resolveHref = resolve as unknown as (path: string) => string;

/**
 * Wrapper around SvelteKit's goto() that automatically prepends the app's
 * base path to absolute URLs. Required when deploying under a sub-path
 * (e.g. PUBLIC_BASE_PATH=/task via nginx reverse proxy).
 *
 * - Absolute paths (starting with /) that don't already include the base
 *   get the base prepended via resolve(): '/auth/login' → '/task/auth/login'
 * - Paths that already include the base (e.g. returnTo from $page.url.pathname)
 *   are passed through unchanged to avoid double-prefixing.
 * - Relative paths and full URLs are passed through unchanged.
 */
export function goto(href: string, opts?: Parameters<typeof _goto>[1]): ReturnType<typeof _goto> {
	if (
		base &&
		href.startsWith('/') &&
		!href.startsWith('//') &&
		!href.startsWith(base + '/') &&
		href !== base
	) {
		return _goto(resolveHref(href), opts);
	}
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- path already includes base or is external
	return _goto(href, opts);
}
