import type { HandleClientError } from '@sveltejs/kit';
import { createLogger, LoggerGlobal, LOG_LEVELS } from '@reborn/utils';
import { initializeStorage } from '@reborn/storage';

// Enable debug logs only in Vite dev server (import.meta.hot is stripped in production builds).
if (import.meta.hot) {
  LoggerGlobal.setMinLevel(LOG_LEVELS.DEBUG);
}
import { cryptoManager } from '@reborn/crypto';
import { base } from '$app/paths';
import { authOperationsService } from '$lib/services/auth-operations.service';
import { sessionExpired } from '$lib/stores/session-expired.store';
import { trashManagementService } from '$lib/services/trash-management.service';
import { recurrenceService } from '$lib/services/recurrence.service';
import { pushNotificationService } from '$lib/services/push-notification.service';
import { startSwUpdateWatcher } from '$lib/services/sw-update.service';
import { startPwaInstallPrompt } from '$lib/services/pwa-install.service';

const logger = createLogger('hooks.client');

// Eagerly construct the session manager singleton at module load time so that
// `auth.store.ts` (which retries on a short interval) can attach immediately
// instead of racing `initializeAuth()` behind the 5s i18n timeout in +layout.ts.
try {
	authOperationsService.getSessionManager();
} catch (error: unknown) {
	logger.error('Failed to eagerly initialize session manager:', error);
}

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
		// Credentials removed → cross-app (or cross-tab) logout.
		// Clear local state BEFORE the redirect so the next login doesn't
		// find stale ciphertexts in IndexedDB encrypted under a previous
		// user's master key — that caused AES-GCM OperationError on decrypt.
		logger.info('Cross-app logout detected via storage event — redirecting to login');
		sessionExpired.set(false);
		cryptoManager.clearMasterKey();
		// Fire-and-forget — the hard redirect below completes the logout even
		// if the IDB clear is still in flight.
		import('@reborn/storage')
			.then(({ clearAllUserData }) => clearAllUserData())
			.catch((err) => logger.error('Failed to clear IndexedDB on cross-app logout:', err))
			.finally(() => {
				window.location.href = `${base}/auth/login`;
			});
		return;
	}

	if (e.oldValue === null) {
		// Credentials appeared (was absent, now present) → cross-app login
		// Redirect to E2E unlock — master key must be decrypted with the user's password
		logger.info('Cross-app login detected via storage event — redirecting to unlock');
		window.location.href = `${base}/auth/unlock`;
	}
});

// ---------------------------------------------------------------------------
// Cross-app E2E unlock (BroadcastChannel)
// ---------------------------------------------------------------------------
// When the peer app (reborn-notes) calls setMasterKey() it broadcasts an
// `unlocked` event over the `reborn_e2e` channel. The master key already lives
// in the shared origin IndexedDB, so this tab can flip hasE2E and bounce off
// /auth/unlock without a second password prompt. The matching `cleared` event
// is defense-in-depth — the primary logout path is the storage listener above.
cryptoManager.subscribeToKeyEvents((event) => {
	if (event === 'unlocked') {
		if (!cryptoManager.isInitialized()) return;
		logger.info('Cross-app E2E unlock detected — flipping hasE2E');
		authOperationsService.getSessionManager().setSession({ hasE2E: true });
		const path = window.location.pathname;
		if (path.includes('/auth/unlock')) {
			window.location.href = `${base}/`;
		}
		return;
	}
	// event === 'cleared'
	const stillAuthenticated = !!localStorage.getItem(CREDENTIALS_KEY);
	if (stillAuthenticated && !cryptoManager.isInitialized()) {
		logger.info('Cross-app key cleared without logout — flipping hasE2E to false');
		authOperationsService.getSessionManager().setSession({ hasE2E: false });
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
				const { appSettings } = await import('$lib/stores/app-settings.store');
				const { get } = await import('svelte/store');
				const {
					DEFAULT_NOTIFICATION_LEAD_MINUTES,
					DEFAULT_NOTIFICATION_ALL_DAY_TIME
				} = await import('$lib/services/push-notification.service');

				const readTimingOptions = async () => ({
					leadMinutes:
						(await getSetting('notification_lead_minutes')) ?? DEFAULT_NOTIFICATION_LEAD_MINUTES,
					allDayTime:
						(await getSetting('notification_all_day_time')) ?? DEFAULT_NOTIFICATION_ALL_DAY_TIME
				});

				const syncIfEnabled = async () => {
					const enabled = await getSetting('notifications_enabled');
					if (!enabled) return;
					const opts = await readTimingOptions();
					await pushNotificationService.syncScheduledNotifications(get(tasks), opts);
				};

				tasks.subscribe(($tasks) => {
					void (async () => {
						const enabled = await getSetting('notifications_enabled');
						if (!enabled) return;
						const opts = await readTimingOptions();
						await pushNotificationService.syncScheduledNotifications($tasks, opts);
					})();
				});

				// Re-sync when notification timing settings change so the user sees
				// the new schedule immediately without waiting for the next trigger.
				let lastLead: number | undefined;
				let lastAllDay: string | undefined;
				appSettings.subscribe(($settings) => {
					if (!$settings) return;
					const lead = $settings.notification_lead_minutes;
					const allDay = $settings.notification_all_day_time;
					if (lastLead === undefined && lastAllDay === undefined) {
						lastLead = lead;
						lastAllDay = allDay;
						return;
					}
					if (lead !== lastLead || allDay !== lastAllDay) {
						lastLead = lead;
						lastAllDay = allDay;
						void syncIfEnabled();
					}
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
