import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isProduction = process.env.NODE_ENV === 'production';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	compilerOptions: {
		runes: true // Enable runes mode for Svelte 5
	},

	kit: {
		adapter: isProduction ? adapterNode() : adapterAuto(),
		// BASE_PATH controls same-origin deployment path (e.g. "/task").
		// Empty in dev. Set PUBLIC_BASE_PATH=/task in production env.
		//
		// `paths.relative: false` forces absolute asset URLs (`/task/_app/...`)
		// instead of SvelteKit 2's default relative (`./_app/...`). The service
		// worker serves the cached `${base}/` shell HTML as SPA fallback for any
		// navigation under base (F5 on `/task/tasks/<id>`, `/task/lists/<id>`,
		// `/task/s/<slug>` etc.). With relative paths the shell's `./_app/...`
		// resolves against the current URL and 404s every chunk; absolute paths
		// work identically from every URL the shell can be served at.
		paths: {
			base: process.env.PUBLIC_BASE_PATH ?? '',
			relative: false
		},
		alias: {
			$lib: './src/lib'
		},
		prerender: {
			// Prerender auth pages for faster loading
			entries: ['/auth/login', '/auth/register', '/auth/unlock']
		},
		csp: {
			mode: 'nonce',
			directives: {
				'default-src': ['self'],
				// SvelteKit auto-injects `'nonce-{nonce}'` because of `mode: 'nonce'`
				// above. Do NOT include literal `'nonce'` here - it gets passed through
				// as a bare token, which browsers interpret as the hostname `https://nonce`
				// (harmless but pollutes the CSP and confuses debugging in Firefox).
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				'font-src': ['self', 'data:'],
				'connect-src': isProduction
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
