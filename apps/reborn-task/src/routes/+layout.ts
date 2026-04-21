import type { LayoutLoad } from './$types';
import { browser } from '$app/environment';
import { initI18n } from '$lib/stores/i18n.store';
import { authOperationsService } from '$lib/services/auth-operations.service';
import { createLogger } from '@reborn/utils';

const logger = createLogger('RootLayoutLoad');

// Global flag to prevent multiple initializations
let isInitialized = false;
let authBootstrapPromise: Promise<void> | null = null;

// Disable SSR for offline-first app
export const ssr = false;

// Enable prerendering for static pages (auth pages)
export const prerender = false;

export const load: LayoutLoad = async () => {
	logger.debug('Layout load started');

	// Prevent re-initialization on client-side navigation
	if (browser && isInitialized) {
		logger.debug('Already initialized, skipping');
		return {
			user: null
		};
	}

	// Initialize i18n with a timeout so a slow/offline dynamic import()
	// doesn't block layout rendering indefinitely. Translations fall back
	// to message keys if this times out.
	await Promise.race([
		initI18n(),
		new Promise<void>((resolve) => setTimeout(resolve, 5000))
	]);

	// NOTE: Storage & settings initialization removed from here — they are
	// already initialized in hooks.client.ts (fire-and-forget) and
	// +layout.svelte onMount() (with isDatabaseInitialized guard).
	// Awaiting IndexedDB in +layout.ts load() blocks the ENTIRE render
	// because SvelteKit waits for load() to complete before mounting the
	// component tree (so the 2s timeout in onMount never fires).

	// Initialize auth on client side and wait for bootstrap handoff.
	// We intentionally await the shared bootstrap promise so downstream routes
	// don't race against a still-uninitialized session store.
	if (browser) {
		logger.debug('Browser environment detected, initializing auth bootstrap');

		if (!authBootstrapPromise) {
			authBootstrapPromise = authOperationsService.initializeAuth().catch((error: unknown) => {
				logger.error('Failed to initialize auth bootstrap:', error);
				// Reset the promise so the app can retry on next navigation.
				authBootstrapPromise = null;
			});
		}

		// Cap the wait so offline cold starts don't stack i18n (5s) + auth
		// bootstrap (another 3–5s of IndexedDB + store refreshes) on top of
		// each other and push total load past the 15s app.html stall timer.
		// hooks.client.ts eagerly constructs the SessionManager, and
		// initializeAuth() sets {isInitialized,isAuthenticated} before any
		// slow IO, so routes can make redirect decisions even if bootstrap
		// continues in the background.
		await Promise.race([
			authBootstrapPromise,
			new Promise<void>((resolve) => setTimeout(resolve, 3000))
		]);

		// Mark as initialized to prevent re-runs
		isInitialized = true;
	} else {
		logger.debug('Server environment, skipping auth initialization');
	}

	// Note: no server-side auth data is fetched for this app — sessions are
	// restored entirely on the client by hooks.client.ts + SessionManager.

	logger.debug('Layout load completed');

	return {
		user: null
	};
};
