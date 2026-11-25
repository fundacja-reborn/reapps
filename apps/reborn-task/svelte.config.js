import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isProduction = process.env.NODE_ENV === 'production';

// Native (Capacitor) build target - the same setup as re/notes. The exact same
// client build, emitted as a static SPA that the native shell bundles and
// loads from a local scheme (https://localhost on Android, capacitor://localhost
// on iOS). It talks to the remote API cross-origin. Selected via
// BUILD_TARGET=native (the `build-native*` targets); the web targets
// (adapter-node / adapter-auto) are untouched when unset.
const isNative = process.env.BUILD_TARGET === 'native';

// Native CSP connect-src needs the remote API origin, derived from the build's
// PUBLIC_API_BASE_URL (e.g. https://reapps.eu/task/api -> https://reapps.eu).
// CapacitorHttp routes fetch through the native layer and bypasses CSP, but this
// keeps connect-src correct as defense-in-depth / if the transport ever changes.
const nativeApiOrigin =
	isNative && process.env.PUBLIC_API_BASE_URL
		? new URL(process.env.PUBLIC_API_BASE_URL).origin
		: null;

function selectAdapter() {
	if (isNative) {
		// SPA mode: a single index.html fallback + client-side routing; the shell
		// always serves index.html as its entry point. strict:false - the /api/*
		// endpoints (+server.ts) are dead code in the static bundle (there is no
		// Node server in the shell) and are simply omitted. Output to
		// build-native/ so the static SPA never clobbers the web adapter-node
		// output in build/ (Capacitor's webDir points here).
		return adapterStatic({
			pages: 'build-native',
			assets: 'build-native',
			fallback: 'index.html',
			strict: false
		});
	}
	return isProduction ? adapterNode() : adapterAuto();
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	compilerOptions: {
		runes: true // Enable runes mode for Svelte 5
	},

	kit: {
		adapter: selectAdapter(),
		// CSRF origin check OFF. The native (Capacitor) client is cross-origin by
		// design - the WebView loads from a local scheme (https://localhost on
		// Android, capacitor://localhost on iOS) and talks to the remote API.
		// SvelteKit's default `checkOrigin` forbids any cross-origin
		// POST/PUT/PATCH/DELETE that carries a "form" content-type, which 403s every
		// bodiless native mutation (delete / restore that send no Content-Type,
		// unlike POST/PATCH which declare application/json and slip through) while
		// same-origin web never trips it. So the check only ever rejected the
		// legitimate native client. Safe to disable: API auth is bearer-token
		// (Authorization header, never an ambient cookie, so it is not auto-attached
		// cross-site) and the lone cookie - the web refresh_token - is httpOnly +
		// SameSite=Lax (never sent cross-site). The origin check is redundant with
		// those defenses. `trustedOrigins: ['*']` is SvelteKit 2.63's non-deprecated
		// spelling of "trust every origin" (old `checkOrigin: false` is deprecated)
		// and also covers a native request that carries no Origin header. Found in
		// native smoke 2026-06-28; see guideline 36.
		csrf: { trustedOrigins: ['*'] },
		// Native prerenders the SPA fallback; SvelteKit cannot fill
		// `%sveltekit.nonce%` in a static page, so native uses a nonce-free
		// template generated from app.html (scripts/gen-native-template.mjs).
		files: {
			appTemplate: isNative ? 'src/app.native.html' : 'src/app.html'
		},
		// The native shell loads assets from the local bundle - a Service Worker
		// adds only a cache layer that can serve a stale shell after a store
		// update, so auto-registration is off there (hooks.client.ts also
		// unregisters SWs left by earlier dev builds). Web registers as before.
		serviceWorker: {
			register: !isNative
		},
		// BASE_PATH controls same-origin deployment path (e.g. "/task").
		// Empty in dev. Set PUBLIC_BASE_PATH=/task in production env. Native
		// always loads from the scheme root, so base is forced empty there.
		//
		// `paths.relative: false` forces absolute asset URLs (`/task/_app/...`)
		// instead of SvelteKit 2's default relative (`./_app/...`). The service
		// worker serves the cached `${base}/` shell HTML as SPA fallback for any
		// navigation under base (F5 on `/task/tasks/<id>`, `/task/lists/<id>`,
		// `/task/s/<slug>` etc.). With relative paths the shell's `./_app/...`
		// resolves against the current URL and 404s every chunk; absolute paths
		// work identically from every URL the shell can be served at.
		paths: {
			base: isNative ? '' : (process.env.PUBLIC_BASE_PATH ?? ''),
			relative: false
		},
		alias: {
			$lib: './src/lib'
		},
		prerender: {
			// Prerender auth pages for faster loading
			entries: ['/auth/login', '/auth/register', '/auth/unlock']
		},
		// Web (SSR) injects a per-request nonce. Native is fully static (no server
		// to mint a nonce), so it uses hashes of the inline scripts/styles.
		csp: {
			mode: isNative ? 'hash' : 'nonce',
			directives: {
				'default-src': ['self'],
				// SvelteKit auto-injects `'nonce-{nonce}'` because of `mode: 'nonce'`
				// above. Do NOT include literal `'nonce'` here - it gets passed through
				// as a bare token, which browsers interpret as the hostname `https://nonce`
				// (harmless but pollutes the CSP and confuses debugging in Firefox).
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'unsafe-inline'],
				// Hash mode (native) nullifies 'unsafe-inline' in style-src, which
				// would block Svelte's runtime inline style attributes. Keep them
				// allowed via style-src-attr. Web (nonce mode) is unaffected.
				...(isNative ? { 'style-src-attr': ['unsafe-inline'] } : {}),
				'img-src': ['self', 'data:'],
				'font-src': ['self', 'data:'],
				'connect-src': isNative
					? ['self', ...(nativeApiOrigin ? [nativeApiOrigin] : [])]
					: isProduction
						? ['self']
						: ['self', 'ws:', 'http://localhost:*', 'ws://localhost:*'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'object-src': ['none']
			}
		}
	},

	// Exclude problematic paths from type checking
	onwarn: (warning, handler) => {
		// Ignore warnings from dependencies
		if (warning.filename && warning.filename.includes('node_modules')) return;
		if (warning.filename && warning.filename.includes('/dist/')) return;
		handler(warning);
	}
};

export default config;
