import type { LayoutLoad } from './$types';
import { browser } from '$app/environment';
import { initI18n } from '$lib/stores/i18n.store';
import { authOperationsService } from '$lib/services/auth-operations.service';
import { createLogger } from '@reborn/utils';

const logger = createLogger('RootLayoutLoad');

// Global flag to prevent multiple initializations
let isInitialized = false;

// Disable SSR for offline-first app
export const ssr = false;

// Enable prerendering for static pages (auth pages)
export const prerender = false;

export const load: LayoutLoad = async ({ data }) => {
	logger.debug('Layout load started');

	// Prevent re-initialization on client-side navigation
	if (browser && isInitialized) {
		logger.debug('Already initialized, skipping');
		return {
			user: data?.user || null
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

	// Initialize auth on client side WITHOUT BLOCKING
	if (browser) {
		logger.debug('Browser environment detected, will initialize auth');
		// Start auth initialization in background
		// DO NOT await - let the layout load immediately
		authOperationsService
			.initializeAuth()
			.then(() => {
				logger.debug('Auth initialized in background');
			})
			.catch((error: unknown) => {
				logger.error('Failed to initialize auth in background:', error);
				// Don't throw - let app work even if auth fails
			});
		// Give a tiny bit of time for session to be marked as initialized
		// This is a compromise between instant loading and avoiding flicker
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Mark as initialized to prevent re-runs
		isInitialized = true;
	} else {
		logger.debug('Server environment, skipping auth initialization');
	}

	// Initialize session store with server data
	if (browser && data?.user) {
		// Dynamic import to avoid SSR issues
		const sessionManager = authOperationsService.getSessionManager();
		try {
			if (sessionManager && typeof sessionManager.setAuthenticated === 'function') {
				sessionManager.setAuthenticated(data.user, true);
			}
		} catch (error: unknown) {
			logger.error('Failed to set user in session manager:', error);
		}
	}

	logger.debug('Layout load completed');

	return {
		user: data?.user || null
	};
};
