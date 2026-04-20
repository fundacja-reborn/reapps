import type { LayoutLoad } from './$types';
import { browser } from '$app/environment';
import { initI18n } from '$lib/stores/i18n.store';
import { authOperationsService } from '$lib/services/auth-operations.service';
import { createLogger } from '@reborn/utils';
// --- STORAGE INIT ---
import { initializeStorage } from '@reborn/storage';

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

	// Initialize i18n first (fast operation)
	await initI18n();

	// --- STORAGE INIT ---
	if (browser) {
		try {
			// Check if storage is already initialized to avoid duplicate initialization
			const { isDatabaseInitialized } = await import('@reborn/storage');
			if (!isDatabaseInitialized()) {
				await initializeStorage('task');
				logger.info('Storage initialized');
			} else {
				logger.debug('Storage already initialized, skipping');
			}

			// Initialize app-specific settings for RebornTask (this is idempotent)
			const { initializeSettings } = await import('$lib/utils/app-settings');
			await initializeSettings();
			logger.debug('App settings check completed');

			// Don't refresh settings store here - it will be done after auth
			// This prevents unnecessary database operations for non-authenticated users
		} catch (error: unknown) {
			logger.error('Failed to initialize storage', error);
			// Let app continue even if storage initialization fails
		}
	}

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
