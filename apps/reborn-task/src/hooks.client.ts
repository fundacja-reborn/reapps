import type { HandleClientError } from '@sveltejs/kit';
import { createLogger } from '@reborn/utils';
import { initializeStorage } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { base } from '$app/paths';
import { trashManagementService } from '$lib/services/trash-management.service';
import { recurrenceService } from '$lib/services/recurrence.service';
import { pushNotificationService } from '$lib/services/push-notification.service';
import { startSwUpdateWatcher } from '$lib/services/sw-update.service';
import { startPwaInstallPrompt } from '$lib/services/pwa-install.service';

const logger = createLogger('hooks.client');

// ---------------------------------------------------------------------------
// Client-side error handler — detect offline chunk-loading failures
// ---------------------------------------------------------------------------
export const handleError: HandleClientError = ({ error }) => {
	const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

	const isDynamicImportFailure =
		error instanceof TypeError &&
		(/dynamically imported module/i.test(error.message) ||
			/failed to fetch/i.test(error.message));

	if (isDynamicImportFailure && isOffline) {
		logger.warn('Offline navigation — dynamic import failed');
		return {
			message: 'Jesteś offline — ta strona nie jest jeszcze dostępna.',
			isOffline: true
		};
	}

	logger.error('Unhandled client error:', error);
	return {
		message: (error as Error)?.message ?? 'Wystąpił nieoczekiwany błąd.'
	};
};

// Start watching for service worker updates — shows a toast when a new
// version is deployed so the user can reload to pick up fresh code.
startSwUpdateWatcher();
startPwaInstallPrompt();

// ---------------------------------------------------------------------------
// Cross-app SSO logout detection
// ---------------------------------------------------------------------------
// The `storage` event fires ONLY in other tabs/windows on the same origin —
// never in the tab that changed localStorage. When the user logs out in
// reborn-notes (or another Task tab), this listener detects the removal of
// `reborn_auth_credentials` and immediately hard-redirects to /auth/login.
// Hard redirect avoids stale in-memory state (SessionManager, CryptoManager,
// decrypted stores) that would otherwise cause broken UI.
const CREDENTIALS_KEY = 'reborn_auth_credentials';

window.addEventListener('storage', (e) => {
	if (e.key !== CREDENTIALS_KEY) return;

	if (e.newValue === null) {
		// Credentials removed → cross-app (or cross-tab) logout
		logger.info('Cross-app logout detected via storage event — redirecting to login');
		cryptoManager.clearMasterKey();
		window.location.href = `${base}/auth/login`;
	} else if (e.oldValue === null) {
		// Credentials appeared (was absent, now present) → cross-app login
		// Redirect to E2E unlock — master key must be decrypted with the user's password
		logger.info('Cross-app login detected via storage event — redirecting to unlock');
		window.location.href = `${base}/auth/unlock`;
	}
});

// ---------------------------------------------------------------------------
// Initialize storage when the app starts
// ---------------------------------------------------------------------------
logger.info('Initializing storage on app startup');

initializeStorage('task')
	.then(async () => {
		logger.info('Storage initialized successfully');

		// Auto-purge old trash items
		try {
			const purgedCount = await trashManagementService.purgeOldTasks();
			if (purgedCount > 0) {
				logger.info(`Auto-purged ${purgedCount} old tasks from trash`);
			}
		} catch (error: unknown) {
			logger.error('Failed to auto-purge old tasks:', error);
			// Don't throw - this is not critical for app startup
		}

		// Start recurrence service
		try {
			recurrenceService.start();
			logger.info('Recurrence service started');
		} catch (error: unknown) {
			logger.error('Failed to start recurrence service:', error);
			// Don't throw - this is not critical for app startup
		}

		// Sync scheduled push notifications.
		//
		// The service worker is killed by the browser after ~30s of inactivity,
		// so any in-memory schedule is lost. To recover we re-push the schedule
		// from the main thread on three triggers:
		//   1. Whenever the decrypted task store changes (edits, sync pulls)
		//   2. When the tab becomes visible (user returns after the SW was idle)
		//   3. Periodically every 15 minutes while the tab is open
		if (pushNotificationService.isSupported()) {
			try {
				const { tasks } = await import('$lib/stores/decrypted-tasks.store');
				const { getSetting } = await import('$lib/utils/app-settings');
				const { get } = await import('svelte/store');

				const syncIfEnabled = async () => {
					const enabled = await getSetting('notifications_enabled');
					if (enabled) {
						await pushNotificationService.syncScheduledNotifications(get(tasks));
					}
				};

				tasks.subscribe(($tasks) => {
					void (async () => {
						const enabled = await getSetting('notifications_enabled');
						if (enabled) {
							await pushNotificationService.syncScheduledNotifications($tasks);
						}
					})();
				});

				document.addEventListener('visibilitychange', () => {
					if (document.visibilityState === 'visible') {
						void syncIfEnabled();
					}
				});

				const FIFTEEN_MINUTES = 15 * 60 * 1000;
				setInterval(() => {
					void syncIfEnabled();
				}, FIFTEEN_MINUTES);

				logger.info('Push notification sync registered');
			} catch (error: unknown) {
				logger.error('Failed to register push notification sync:', error);
				// Don't throw - not critical
			}
		}
	})
	.catch((error) => {
		logger.error('Failed to initialize storage:', error);
		// Don't throw - app should still try to work
	});
