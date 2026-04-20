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
		paths: {
			base: process.env.PUBLIC_BASE_PATH ?? ''
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
				'script-src': ['self', 'nonce', 'wasm-unsafe-eval'],
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
