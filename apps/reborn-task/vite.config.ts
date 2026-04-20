import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import tailwindcss from '@tailwindcss/vite';

const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(rootPkg.version)
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		{
			name: 'fix-svelte-toolbelt',
			enforce: 'pre',
			resolveId(id) {
				if (id === 'svelte-toolbelt') {
					return resolve('../../node_modules/svelte-toolbelt/dist/index.js');
				}
			}
		}
	],
	// Load .env from monorepo root
	envDir: '../../',
	resolve: {
		alias: {
			$lib: resolve('./src/lib'),
			'@reborn/auth/server': resolve('../../packages/auth/src/server.ts'),
			'@reborn/auth': resolve('../../packages/auth/src/index.ts'),
			'@reborn/crypto': resolve('../../packages/crypto/src/index.ts'),
			'@reborn/types': resolve('../../packages/types/src/index.ts'),
			'@reborn/utils': resolve('../../packages/utils/src/index.ts'),
			'@reborn/storage': resolve('../../packages/storage/src/index.ts'),
			'@reborn/api-client': resolve('../../packages/api-client/src/index.ts'),
			// Removed @reborn/ui alias to let Vite use package.json exports
			'@reborn/i18n': resolve('../../packages/i18n/src/index.ts')
		}
	},
	server: {
		port: 4200,
		host: 'localhost',
		allowedHosts: ['reapps.eu'],
		// When behind nginx proxy (PUBLIC_BASE_PATH set), HMR connects directly to Vite
		// instead of going through the proxy — avoids WebSocket path mismatch
		...(process.env.PUBLIC_BASE_PATH && {
			hmr: {
				protocol: 'ws',
				host: 'localhost',
				clientPort: 4200
			}
		}),
		// Warm up files for faster loading
		warmup: {
			clientFiles: [
				'./src/routes/+layout.svelte',
				'./src/routes/+layout.ts',
				'./src/lib/stores/auth.store.ts',
				'./src/lib/stores/decrypted-lists.store.ts',
				'./src/routes/+page.svelte',
				'./src/routes/+page.svelte',
				'./src/routes/auth/login/+page.svelte'
			]
		}
	},
	optimizeDeps: {
		include: [
			'svelte-i18n',
			// NOTE: @reborn/* packages are NOT pre-bundled here — they have resolve.alias
			// entries pointing to source .ts files, so Vite transforms them as app code.
			// Pre-bundling would cache stale versions and break HMR for package changes.
			'@lucide/svelte',
			'clsx',
			'tailwind-merge',
			'dexie',
			'bits-ui',
			'svelte-toolbelt',
			'zod',
			// Add missing dependencies that cause runtime optimization
			'deepmerge',
			'intl-messageformat',
			'jose',
			'uuid',
			'idb',
			'tailwind-variants',
			'class-variance-authority'
		],
		exclude: [
			'@prisma/client',
			'.prisma/client',
			'@reborn/database',
			'@reborn/ui',
			'mode-watcher',
			'svelte-sonner'
		],
		entries: [
			'./src/routes/+layout.ts',
			'./src/routes/+layout.svelte',
			'./src/lib/stores/auth.store.ts',
			'./src/lib/auth/authService.ts'
		]
	},
	ssr: {
		noExternal:
			process.env.NODE_ENV === 'production'
				? ['@lucide/svelte', 'bits-ui', 'svelte-toolbelt', 'runed', 'esm-env']
				: [
						/^@reborn\/(?!database).*/,
						'@lucide/svelte',
						'bits-ui',
						'svelte-toolbelt',
						'runed',
						'esm-env'
					],
		external: ['@reborn/database', '@prisma/client', '.prisma/client']
	},
	build: {
		sourcemap: false,
		rollupOptions: {
			external: ['@prisma/client', '.prisma/client'],
			output: {
				// Split vendor chunks for better caching
				manualChunks: (id) => {
					// Skip SSR externals and node_modules that might be problematic
					if (id.includes('node_modules')) {
						// Group by package name for vendor chunks
						if (id.includes('svelte') || id.includes('@sveltejs/kit')) {
							return 'vendor-svelte';
						}
						if (
							id.includes('clsx') ||
							id.includes('tailwind-merge') ||
							id.includes('tailwind-variants')
						) {
							return 'vendor-ui';
						}
						if (id.includes('dexie') || id.includes('idb')) {
							return 'vendor-storage';
						}
						if (
							id.includes('zod') ||
							id.includes('uuid') ||
							id.includes('deepmerge') ||
							id.includes('intl-messageformat')
						) {
							return 'vendor-utils';
						}
					}
				}
			}
		},
		// Optimize chunk size
		chunkSizeWarningLimit: 1000
	}
});
