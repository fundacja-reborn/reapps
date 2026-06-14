import { browser } from '$app/environment';
import { base } from '$app/paths';
import {
	initializeAuthService,
	getAuthService,
	getSessionManager,
	login as authLogin,
	logout as authLogout,
	unlockE2E as authUnlockE2E
} from '$lib/auth';
import { AuthStorageAdapter } from '$lib/auth/adapters/authStorage';
import { createLogger } from '@reborn/utils';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@reborn/i18n';
import type { AuthUser } from '@reborn/auth';
import type { CryptoManager } from '@reborn/crypto';
import type { ReAuthResult } from '@reborn/ui';
import { syncService } from './sync.service';
import { taskTitleIndex } from './task-title-index.svelte';
import { taskListStore } from '$lib/stores/decrypted-lists.store';
import { setLocale } from '$lib/stores/i18n.store';
import { sessionExpired } from '$lib/stores/session-expired.store';

const logger = createLogger('AuthOperationsService');

/** Minimal shape of the JSON body returned by the re-auth endpoints. */
interface ReAuthResponseBody {
	success?: boolean;
	error?: string;
	data?: {
		twoFactorRequired?: boolean;
		userId?: string;
		access_token?: string;
	};
}

// Use globalThis to ensure true singleton across hot reloads
declare global {
	var __authServiceInitialized: boolean | undefined;
	var __sessionManagerInstance: ReturnType<typeof getSessionManager> | undefined;
	var __tokenRefreshInterval: ReturnType<typeof setInterval> | undefined;
}

export class AuthOperationsService {
	/**
	 * Detect local IDB data encrypted under a different master key than the one
	 * currently loaded, and recover by wiping local data + re-pulling from server.
	 *
	 * Happens when a user logs out in the peer app (storage event clears the
	 * crypto key) and logs in as a different user, but Task's IndexedDB still
	 * holds ciphertexts from the previous user. Next decrypt throws AES-GCM
	 * OperationError — this helper turns that into a clean recovery.
	 *
	 * Safe no-op when: no key loaded, IDB empty, offline, or data is readable.
	 * Returns `true` if a recovery wipe was performed (caller should re-sync).
	 */
	async recoverFromKeyMismatch(): Promise<boolean> {
		if (!browser) return false;
		try {
			const { cryptoManager } = await import('@reborn/crypto');
			if (!cryptoManager.isInitialized()) return false;

			const { listStore } = await import('@reborn/storage');
			const { get } = await import('svelte/store');

			const encryptedLists = get(listStore.items) as Array<{
				name_encrypted?: string;
				deleted_at?: string | null;
			}>;
			const probe = encryptedLists.find((l) => !l.deleted_at && l.name_encrypted);
			if (!probe?.name_encrypted) return false;

			try {
				await cryptoManager.decryptText(probe.name_encrypted);
				return false; // data decrypts — all good
			} catch {
				logger.warn(
					'Local data appears encrypted under a different master key — recovering'
				);
			}

			if (!navigator.onLine) {
				logger.error(
					'Offline — cannot wipe & re-pull. Local Task data will remain unreadable until online.'
				);
				return false;
			}

			const { clearAllUserData } = await import('@reborn/storage');
			await clearAllUserData();
			logger.info('Local IndexedDB wiped after key/data mismatch — triggering initial sync');

			try {
				await syncService.initialSync();
			} catch (err) {
				logger.error('Initial sync after recovery failed:', err);
			}
			return true;
		} catch (error: unknown) {
			logger.error('Key-mismatch recovery failed:', error);
			return false;
		}
	}

	private isDefinitiveSessionExpiry(message: string | undefined): boolean {
		if (!message) return false;
		const normalized = message.toLowerCase();
		return (
			normalized.includes('unauthorized') ||
			normalized.includes('forbidden') ||
			normalized.includes('expired') ||
			normalized.includes('invalid') ||
			normalized.includes('revoked') ||
			normalized.includes('401') ||
			normalized.includes('403')
		);
	}

	private markSessionExpired(reason: string): void {
		if (!browser || !navigator.onLine) return;
		logger.warn(`Marking session as expired (${reason})`);
		sessionExpired.set(true);
	}

	private clearSessionExpired(): void {
		sessionExpired.set(false);
	}

	/**
	 * Initialize storage callback
	 * This is called from AuthService after successful login/unlock.
	 *
	 * `context` distinguishes user-switching flows (login) from same-user key
	 * restore on app start (restore). Clearing IndexedDB is only correct for
	 * login — on restore it would wipe offline changes that haven't been synced.
	 */
	private async onStorageInit(
		cryptoManager: CryptoManager,
		context: 'login' | 'restore' = 'login',
		authToken?: string
	) {
		logger.info(`Initializing storage with E2E encryption (context=${context})`);

		try {
			// Database is now initialized in @reborn/storage package
			logger.info('Using @reborn/storage for data management');

			// Clear any previous user's data from IndexedDB ONLY on login — prevents
			// ghost tasks when switching users or after account deletion + re-register.
			// On 'restore' (same user, master key loaded from IndexedDB on app start)
			// we MUST preserve local data, otherwise offline edits are lost.
			if (context === 'login') {
				const { clearAllUserData, isDatabaseInitialized } = await import('@reborn/storage');
				if (isDatabaseInitialized()) {
					try {
						await clearAllUserData();
						logger.info('Cleared previous user data from IndexedDB before login');
					} catch (err) {
						logger.error('Failed to clear IndexedDB before login:', err);
					}
				}
			}

			// Import only stores used by Reborn Task app
			const {
				taskStore,
				listStore,
				subtaskStore,
				userStore,
				syncStateStore,
				offlineOperationsStore
			} = await import('@reborn/storage');

			// Refresh stores relevant to Reborn Task after authentication
			logger.info('Refreshing Reborn Task stores after authentication');
			await Promise.all([
				taskStore.refreshItems(),
				listStore.refreshItems(),
				subtaskStore.refreshItems(),
				userStore.refreshItems(),
				syncStateStore.refreshItems(),
				offlineOperationsStore.refreshItems()
			]);
			logger.info('Reborn Task stores refreshed successfully');

			// Use the provided token or check localStorage
			const accessToken = authToken || localStorage.getItem('access_token');
			if (accessToken) {
				syncService.setAuthToken(accessToken);
				logger.debug('Auth token set in sync service during storage init');
			} else {
				logger.warn('No auth token available during storage init');
			}

			// Load task lists from IndexedDB first (offline-first approach)
			try {
				await taskListStore.loadLists();
				logger.info('Task lists loaded from IndexedDB');
			} catch (loadError) {
				logger.error('Failed to load task lists:', loadError);
				// Continue - empty list is better than failure
			}

			// Restore path: guard against stale ciphertexts encrypted under a
			// previous user's key. `context==='login'` already cleared IDB above,
			// so this is a no-op there.
			if (context === 'restore') {
				const recovered = await this.recoverFromKeyMismatch();
				if (recovered) {
					try {
						await taskListStore.loadLists();
					} catch (err) {
						logger.error('Failed to reload lists after key-mismatch recovery:', err);
					}
				}
			}

			// Perform initial sync if online (non-blocking)
			if (navigator.onLine) {
				// Start sync in background - don't await
				syncService
					.initialSync()
					.then(() => {
						logger.info('Background sync completed');
						// Reload lists after sync
						return taskListStore.loadLists();
					})
					.then(async () => {
						// Ensure default list exists after sync (safety net for SSO users)
						const userId = this.getUserIdFromCredentials();
						if (userId) {
							const { listOperationsService } = await import('./list-operations.service');
							await listOperationsService.ensureDefaultList(userId);
							await taskListStore.loadLists();
						}
					})
					.catch((syncError) => {
						logger.error('Background sync failed:', syncError);
						// Ignore - app works offline
					});
			}

			logger.info('Storage initialized successfully with E2E encryption');

			// Send encrypted device info to server (non-blocking, non-critical)
			import('$lib/services/device-info.service').then(({ sendEncryptedDeviceInfo }) =>
				// fire-and-forget: device info is non-critical
				sendEncryptedDeviceInfo().catch(() => {})
			);
		} catch (error: unknown) {
			logger.error('Failed to initialize storage:', error);
			// Don't throw - app should work offline
		}
	}

	/**
	 * Language change callback
	 */
	private onLanguageChange(language: string) {
		logger.info('Language changed to:', language);
		// Update the locale in i18n store
		if (SUPPORTED_LOCALES.includes(language as SupportedLocale)) {
			setLocale(language as SupportedLocale);
		}
	}

	/**
	 * Ensure auth service is initialized (global singleton)
	 */
	private ensureAuthServiceInitialized() {
		if (!globalThis.__authServiceInitialized && browser) {
			logger.debug('Initializing auth service for the first time');
			const { sessionManager } = initializeAuthService(
				this.onStorageInit.bind(this),
				this.onLanguageChange.bind(this)
			);
			globalThis.__sessionManagerInstance = sessionManager;
			globalThis.__authServiceInitialized = true;
			logger.debug('Auth service initialized successfully');

			// If we already have an access token, set it immediately in syncService
			const accessToken = localStorage.getItem('access_token');
			if (accessToken) {
				syncService.setAuthToken(accessToken);
				logger.debug('Auth token restored to sync service during auth initialization');
			}
		} else if (globalThis.__authServiceInitialized) {
			logger.debug('Auth service already initialized (global)');
		} else {
			logger.debug('Cannot initialize auth service - not in browser');
		}
	}

	/**
	 * Get session manager instance (global singleton)
	 */
	getSessionManager() {
		this.ensureAuthServiceInitialized();
		return globalThis.__sessionManagerInstance || getSessionManager();
	}

	/**
	 * Login user with credentials
	 */
	async login(username: string, password: string) {
		if (!browser) throw new Error('Login requires browser environment');

		this.ensureAuthServiceInitialized();

		try {
			const result = await authLogin(username, password);

			// Note: Token storage and sync service update is now handled in AuthApiAdapter
			// This ensures tokens are available BEFORE AuthService.completeLogin runs

			// Clear stale session-expired banner from a previous session
			this.clearSessionExpired();

			return result;
		} catch (error: unknown) {
			logger.error('Login failed:', error);
			throw error;
		}
	}

	/**
	 * Enter local-only / no-account mode: usable, encrypted, no server session,
	 * no sync. Generates a device-scoped user id and a local master key
	 * (persisted at-rest by CryptoManager - IndexedDB on web, Keychain/Keystore
	 * vault on native) when one is not already loaded, sets a synthetic local
	 * session, and bootstraps a default list.
	 *
	 * The session's `user.id` is the device id on purpose: every existing
	 * `session.user.id`-based list/task operation then works unchanged in local
	 * mode (the username is empty - the UI shows a local-mode label instead).
	 *
	 * Returns false (no-op) if a real account session already exists - the
	 * account always wins. See planning/local-only-no-account-plan.md.
	 */
	async enterLocalMode(): Promise<boolean> {
		if (!browser) return false;
		// Never shadow a real account session.
		if (localStorage.getItem('reborn_auth_credentials')) return false;

		this.ensureAuthServiceInitialized();

		try {
			const { getOrCreateLocalUserId, LOCAL_MODE_KEY, localOnly } = await import(
				'$lib/stores/local-mode.store'
			);
			const { cryptoManager } = await import('@reborn/crypto');

			const localUserId = getOrCreateLocalUserId();
			localStorage.setItem(LOCAL_MODE_KEY, '1');

			// Generate + persist a local master key unless one is already loaded
			// (e.g. restored from IndexedDB/vault on a returning local session).
			// A local passcode wrap means the key is LOCKED behind a passcode, not
			// absent: generating a fresh key here would purge the wrap
			// (setMasterKey) and orphan every record encrypted under the real key.
			// Refuse so the data is recoverable - the caller routes to /auth/lock.
			if (!cryptoManager.isInitialized()) {
				if (cryptoManager.isLocalPasscodeEnabled()) {
					logger.warn(
						'Local passcode set but key locked - refusing to start a fresh local session (would orphan encrypted data)'
					);
					return false;
				}
				const key = await cryptoManager.generateMasterKey();
				await cryptoManager.setMasterKey(key);
			}

			// Storage is normally initialized in hooks.client.ts; be defensive on
			// the entry-page path where it may not be ready yet.
			const { isDatabaseInitialized, initializeStorage } = await import('@reborn/storage');
			if (!isDatabaseInitialized()) await initializeStorage('task');

			// Mark local mode BEFORE any list bootstrap so the immediate
			// scheduleSyncSoon() from ensureDefaultList() no-ops (no server here).
			localOnly.set(true);

			const now = new Date().toISOString();
			const sessionManager = this.getSessionManager();
			sessionManager.setSession({
				isAuthenticated: false,
				isLocalOnly: true,
				isInitialized: true,
				isLoading: false,
				hasE2E: cryptoManager.isInitialized(),
				user: { id: localUserId, username: '', created_at: now, updated_at: now },
				error: null
			});

			// Bootstrap a default list so the app has somewhere to put tasks.
			const { listOperationsService } = await import('./list-operations.service');
			await listOperationsService.ensureDefaultList(localUserId);

			// Refresh decrypted stores so the default list shows immediately.
			const { refreshDecryptedLists } = await import('$lib/stores/decrypted-lists.store');
			await taskListStore.loadLists();
			await refreshDecryptedLists();

			logger.info('Entered local-only (no-account) mode');
			return true;
		} catch (err: unknown) {
			logger.error('Failed to enter local-only mode:', err);
			return false;
		}
	}

	/**
	 * Finish a local-only -> account upgrade after a successful register call.
	 * Promotes the session straight from the register response WITHOUT going
	 * through login() (whose onStorageInit clears IndexedDB on context='login'
	 * and would wipe the very local data we are adopting). The adopted master key
	 * is already in memory, so no unlock is needed: we re-stamp local data with
	 * the account id + flag it pending, set the session, then push + pull to
	 * converge. See planning/local-only-no-account-plan.md (decision B1).
	 */
	async completeLocalUpgrade(params: {
		user: AuthUser;
		accessToken: string;
		encryptedMasterKey: string;
		masterKeySalt: string;
	}): Promise<void> {
		if (!browser) return;
		this.ensureAuthServiceInitialized();

		const { user, accessToken, encryptedMasterKey, masterKeySalt } = params;

		// Persist account credentials in the same shape the normal login flow uses
		// (AuthService.saveAuthCredentials) so the next cold start restores cleanly.
		const storage = new AuthStorageAdapter();
		await storage.saveCredentials({
			id: 'currentUser',
			encrypted_master_key: encryptedMasterKey,
			master_key_salt: masterKeySalt,
			user_profile: user
		});
		localStorage.setItem('access_token', accessToken);

		// Leave local-only mode: the account now owns this data.
		const { clearLocalModeMarkers, localOnly } = await import('$lib/stores/local-mode.store');
		clearLocalModeMarkers();
		localOnly.set(false);

		// A local passcode (if one was set) protected the local key; the account
		// password now owns it. Drop the local wrap and re-persist the key at-rest
		// (base), restoring normal stay-unlocked for the account. The adopted key
		// is already in memory here, so disableLocalPasscode() can re-wrap it.
		const { cryptoManager } = await import('@reborn/crypto');
		if (cryptoManager.isLocalPasscodeEnabled()) {
			await cryptoManager.disableLocalPasscode();
		}

		// Re-stamp local data with the account user id + flag pending so it uploads
		// and is visible under the account immediately (lists query by user_id).
		const { markAllLocalDataForUpload } = await import('./local-mode.service');
		await markAllLocalDataForUpload(user.id);

		// Promote the session directly (NOT login() - that clears IndexedDB).
		syncService.setAuthToken(accessToken);
		const sessionManager = this.getSessionManager();
		sessionManager.setSession({
			isAuthenticated: true,
			isLocalOnly: false,
			isInitialized: true,
			isLoading: false,
			hasE2E: true,
			user,
			error: null
		});
		this.clearSessionExpired();
		this.startBackgroundTokenRefresh();

		// Push the adopted data, then pull to converge user_id / sync_version.
		// initialSync() flushes the offline-op queue (push) before pulling, so the
		// adopted local lists/tasks reach the server and come back owned by the
		// account. Best-effort: a failure just defers to the next periodic sync.
		try {
			await syncService.initialSync();
			const { refreshDecryptedLists } = await import('$lib/stores/decrypted-lists.store');
			const { refreshDecryptedSubtasks } = await import('$lib/stores/decrypted-subtasks.store');
			await taskListStore.loadLists();
			await Promise.all([refreshDecryptedLists(), refreshDecryptedSubtasks()]);
			await taskTitleIndex.rebuild();
			const { taskCounts } = await import('$lib/stores/task-counts.store');
			taskCounts.refresh();
		} catch (err: unknown) {
			logger.warn('Initial sync after local-to-account upgrade failed:', err);
		}

		// Send encrypted device info (non-blocking, non-critical).
		import('$lib/services/device-info.service').then(({ sendEncryptedDeviceInfo }) =>
			sendEncryptedDeviceInfo().catch(() => {})
		);
	}

	/**
	 * Logout user
	 */
	async logout() {
		if (!browser) return;

		this.ensureAuthServiceInitialized();

		// Flush pending offline operations BEFORE logout, while auth token is still valid
		if (navigator.onLine) {
			try {
				await Promise.race([
					syncService.syncOfflineOperations(),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error('Sync timeout on logout')), 3000)
					)
				]);
				logger.info('Pending operations flushed before logout');
			} catch (error: unknown) {
				logger.warn('Could not flush pending operations before logout:', error);
			}

			// Flush any pending E2E synced settings push before the master key is
			// cleared — otherwise the last sub-debounce-window setting change
			// would be lost (server keeps stale, IDB gets wiped).
			try {
				const { syncedSettings } = await import('$lib/services/synced-settings.service');
				await Promise.race([
					syncedSettings.pushNow(),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error('Settings push timeout on logout')), 2000)
					)
				]);
			} catch (error: unknown) {
				logger.warn('Could not flush synced settings before logout:', error);
			}
		}

		try {
			await authLogout();
		} finally {
			// Reset session expired flag — this is an intentional logout, not expiry
			this.clearSessionExpired();

			// Clear tokens
			localStorage.removeItem('access_token');

			// Stop background token refresh
			if (globalThis.__tokenRefreshInterval) {
				clearInterval(globalThis.__tokenRefreshInterval);
				globalThis.__tokenRefreshInterval = undefined;
			}

			// Note: CryptoManager session storage (TEMP_MASTER_KEY_EXPORT) is cleared
			// by authLogout() → clearMasterKey() above.

			// Clear sync service
			syncService.setAuthToken('');

			// Clear title index cache
			taskTitleIndex.clear();

			// Clear all user data from IndexedDB
			try {
				const { clearAllUserData } = await import('@reborn/storage');
				await clearAllUserData();
				logger.info('All user data cleared from IndexedDB');
			} catch (error: unknown) {
				logger.error('Failed to clear user data:', error);
				// Don't interrupt logout process on error
			}

			// Hard redirect to login — guarantees ALL in-memory state
			// (Svelte stores, module singletons, $state) is cleared.
			window.location.href = `${base}/auth/login`;
		}
	}

	/**
	 * Logout from all devices — calls the server endpoint, then performs
	 * full local cleanup (same as logout) and redirects to login.
	 */
	async logoutAllDevices() {
		if (!browser) return;

		this.ensureAuthServiceInitialized();

		// Call server to invalidate all sessions
		try {
			const { PUBLIC_BASE_PATH } = await import('$env/static/public');
			const accessToken = localStorage.getItem('access_token');
			await fetch(`${PUBLIC_BASE_PATH}/api/auth/logout-all`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${accessToken}` }
			});
		} catch (error: unknown) {
			logger.warn('Server logout-all call failed:', error);
			// Continue with local cleanup regardless
		}

		// Reset session expired flag — this is an intentional logout, not expiry
		this.clearSessionExpired();

		// Clear auth state in memory (master key, session manager)
		try {
			await authLogout(true); // skipApiCall — server already handled above
		} catch (error: unknown) {
			logger.warn('Auth state cleanup failed:', error);
		}

		// Full local cleanup (same as logout)
		localStorage.removeItem('access_token');

		if (globalThis.__tokenRefreshInterval) {
			clearInterval(globalThis.__tokenRefreshInterval);
			globalThis.__tokenRefreshInterval = undefined;
		}

		// Note: CryptoManager session storage (TEMP_MASTER_KEY_EXPORT) is cleared
		// by authLogout(true) → clearMasterKey() above.

		syncService.setAuthToken('');
		taskTitleIndex.clear();

		try {
			const { clearAllUserData } = await import('@reborn/storage');
			await clearAllUserData();
			logger.info('All user data cleared from IndexedDB after logout-all');
		} catch (error: unknown) {
			logger.error('Failed to clear user data:', error);
		}

		// Hard redirect to login — guarantees ALL in-memory state
		// (Svelte stores, module singletons, $state) is cleared.
		window.location.href = `${base}/auth/login`;
	}

	/**
	 * Unlock E2E encryption
	 */
	async unlockE2E(password: string) {
		if (!browser) {
			return { success: false, message: 'Not in browser environment' };
		}

		this.ensureAuthServiceInitialized();

		try {
			const result = await authUnlockE2E(password);

			if (result.success) {
				// If online, ensure session is valid before syncing
				if (navigator.onLine) {
					const sessionValid = await this.checkSession();
					if (!sessionValid) {
						// Session expired — re-authenticate with the same password.
						// If 2FA is required or re-auth fails, leave the banner flow to
						// prompt the user; unlock itself already succeeded.
						logger.info('Session expired after unlock, attempting auto re-authentication');
						const reAuthResult = await this.reAuthenticate(password);
						if (reAuthResult.kind === 'ok') {
							logger.info('Auto re-authentication successful after unlock');
						} else {
							logger.warn(`Auto re-authentication did not complete: ${reAuthResult.kind}`);
						}
					}

					// Wait for the sync that onStorageInit already started.
					// initialSync() returns the in-flight promise so this won't
					// start a second sync — it waits for the existing one.
					await syncService.initialSync();
				}

				// Reconcile any IDB shadow indexes that drifted from the
				// metadata bundle (recovery for the 2026-05-10 incident — see
				// shadow-index-reconciler.service.ts). Cheap no-op when IDB
				// is consistent. Run before loadLists so any UI that reads
				// task counts immediately afterwards sees corrected state.
				try {
					const { verifyAndRebuildLocalShadowIndexes } = await import(
						'./shadow-index-reconciler.service'
					);
					await verifyAndRebuildLocalShadowIndexes();
				} catch (err) {
					logger.warn('Shadow index reconciliation failed (non-fatal):', err);
				}

				// Reload lists after sync completes
				await taskListStore.loadLists();

				// Note: ensureDefaultList() is called inside onStorageInit's
				// post-sync .then() chain. No need to call it here again —
				// doing so caused race conditions when sync hadn't completed yet.
			}

			return result;
		} catch (error: unknown) {
			logger.error('E2E unlock failed:', error);
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Unlock failed'
			};
		}
	}

	/**
	 * Check if session is valid and restore it.
	 *
	 * Always performs a refresh on the access token when one is present in
	 * localStorage — even if `sessionManager.isAuthenticated()` is already true
	 * after restoring persisted credentials. The previously-stored token may
	 * have expired (15 min TTL) while the user was away; without a proactive
	 * refresh, the first sync after a cold start would 401 and silently fail.
	 */
	async checkSession(): Promise<boolean> {
		if (!browser) return false;

		this.ensureAuthServiceInitialized();

		try {
			const accessToken = localStorage.getItem('access_token');

			if (!accessToken) {
				logger.debug('No access token found in localStorage');
				return false;
			}

			const sessionManager = this.getSessionManager();
			logger.debug('Refreshing access token on bootstrap...');

			// Create a promise that resolves after timeout
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Token refresh timeout')), 10_000)
			);

			// Try to restore session from API with timeout
			// Refresh token is sent automatically via httpOnly cookie
			const authService = getAuthService();
			const result = await Promise.race([
				authService.refreshToken(),
				timeoutPromise
			]).catch((error) => {
				logger.warn('Token refresh failed or timed out:', error);
				return {
					success: false,
					message: error instanceof Error ? error.message : 'Token refresh failed'
				};
			});

			if (result && result.success && 'accessToken' in result && result.accessToken) {
				logger.debug('Token refresh successful');
				// Update stored access token
				localStorage.setItem('access_token', result.accessToken);
				// Note: refresh_token is managed exclusively via httpOnly cookie

				// IMPORTANT: Update sync service IMMEDIATELY after token refresh
				syncService.setAuthToken(result.accessToken);
				logger.debug('Auth token updated in sync service after refresh');

				this.clearSessionExpired();

				// Mark session as initialized and authenticated
				sessionManager.setSession({ isInitialized: true });

				return true;
			}

			const message = 'message' in result ? result.message : undefined;
			if (this.isDefinitiveSessionExpiry(message)) {
				this.markSessionExpired('checkSession-refresh-failed');
			} else {
				logger.debug('Token refresh failed for transient reason, keeping session-expired flag unchanged');
			}

			return false;
		} catch (error: unknown) {
			logger.error('Session check failed:', error);
			return false;
		}
	}

	/**
	 * Check and restore E2E encryption status.
	 * Uses CryptoManager.waitForRestore() which restores the master key from
	 * IndexedDB (survives browser/PWA restart) or sessionStorage (fallback).
	 *
	 * We only flip `hasE2E` here — do NOT trigger onStorageInit('restore').
	 * +layout.svelte's onMount already awaits cryptoManager.waitForRestore()
	 * and refreshes all stores; the $effect watching hasE2E runs initialSync
	 * with a `hasTriggeredInitialSync` dedup flag. Calling onStorageInit here
	 * would race those two paths and, on offline cold starts, caused decrypt
	 * `OperationError` failures and a bogus redirect to /auth/login.
	 */
	private async checkE2EStatus() {
		try {
			const { cryptoManager } = await import('@reborn/crypto');

			// Wait for CryptoManager to finish restoring master key from IndexedDB
			await cryptoManager.waitForRestore();

			if (cryptoManager.isInitialized()) {
				logger.info('E2E initialized (master key restored from IndexedDB)');
				const sessionManager = this.getSessionManager();
				sessionManager.setSession({ hasE2E: true });
			} else {
				logger.info('E2E not initialized, user will need to unlock');
			}
		} catch (error: unknown) {
			logger.warn('Failed to check E2E status:', error);
		}
	}

	/**
	 * Initialize auth on app start
	 */
	async initializeAuth() {
		if (!browser) return;

		logger.info('Starting auth initialization');
		this.clearSessionExpired();

		this.ensureAuthServiceInitialized();

		try {
			const sessionManager = this.getSessionManager();

			// Now perform quick checks without blocking
			const accessToken = localStorage.getItem('access_token');
			// Refresh token is in httpOnly cookie — not accessible from JS
			const hasTokens = !!accessToken;

			// If we have an access token, immediately set it in syncService
			if (accessToken) {
				syncService.setAuthToken(accessToken);
				logger.debug('Auth token restored to sync service from localStorage');
			}

			// Mark session as initialized but keep isLoading=true until persisted
			// credentials have been read. Flipping isLoading=false here would let
			// `+page.ts` waitForSessionReady() return on {isAuthenticated:false}
			// and bounce a cold start to /auth/login before setAuthenticated()
			// has had a chance to run.
			sessionManager.setSession({ isInitialized: true, isLoading: true });
			logger.debug('Session marked as initialized (isLoading=true until auth resolves)');

			// Hydrate isAuthenticated from persisted credentials unconditionally —
			// mirrors reborn-notes' authStore.initialize(). We intentionally do NOT
			// branch on navigator.onLine: an active VPN tunnel (e.g. Proton) causes
			// navigator.onLine to report true even in airplane mode, which used to
			// skip this path and wait on a network refresh that could never succeed,
			// leaving the user stranded on /auth/login.
			const storage = new AuthStorageAdapter();
			const credentials = await storage.getCredentials();
			if (credentials?.user_profile) {
				logger.info('Restoring session from persisted credentials');
				sessionManager.setAuthenticated(credentials.user_profile, false);
			} else if (hasTokens) {
				// Legacy fallback — access token without a credentials record.
				sessionManager.setSession({ isAuthenticated: true });
			} else {
				// No account session: restore local-only mode if its marker is set.
				// A real account always wins over the marker, so this branch is
				// reached only when there are no valid credentials/tokens. The local
				// master key is restored from IndexedDB by checkE2EStatus() below,
				// which flips hasE2E once waitForRestore() resolves.
				const { readLocalModeFromStorage, localOnly } = await import(
					'$lib/stores/local-mode.store'
				);
				const local = readLocalModeFromStorage();
				if (local.active && local.userId) {
					logger.info('Restoring local-only (no-account) session');
					const epoch = new Date(0).toISOString();
					sessionManager.setSession({
						isAuthenticated: false,
						isLocalOnly: true,
						isInitialized: true,
						user: { id: local.userId, username: '', created_at: epoch, updated_at: epoch },
						error: null
					});
					localOnly.set(true);
				}
			}

			// Restore E2E status from IndexedDB (master key may survive PWA restart).
			await this.checkE2EStatus();

			// Release isLoading before any network work so the UI can render.
			sessionManager.setLoading(false);

			// Background refresh — non-critical. A definitive 401/invalid_grant
			// sets sessionExpired=true (banner + re-auth, master key preserved;
			// see docs/development/guidelines/31-session-expiry-handling.md).
			// Transient network errors are left alone — the user may actually be
			// offline despite navigator.onLine=true (e.g. VPN tunnel without
			// upstream connectivity).
			if (navigator.onLine && hasTokens) {
				logger.debug('Online with tokens — refreshing session in background');
				Promise.resolve().then(async () => {
					try {
						const success = await this.checkSession();
						if (success) {
							this.startBackgroundTokenRefresh();
						}
					} catch (error: unknown) {
						logger.warn('Background session refresh failed (non-fatal):', error);
					}
				});
			} else if (!hasTokens) {
				const authService = getAuthService();
				const hasOffline = await authService.hasOfflineCredentials();
				if (hasOffline) {
					logger.info('Offline credentials available');
				}
			}
		} catch (error: unknown) {
			logger.error('Auth initialization failed:', error);
			// Even on error, mark session as initialized to prevent hanging
			const sessionManager = this.getSessionManager();
			sessionManager.setSession({
				isInitialized: true,
				isLoading: false,
				error: error instanceof Error ? error.message : 'Auth initialization failed'
			});
		}
	}

	/**
	 * Start background token refresh — refreshes the access token every 10 minutes
	 * to prevent mid-session expiry without requiring page reload.
	 */
	private startBackgroundTokenRefresh() {
		// Clear any existing interval
		if (globalThis.__tokenRefreshInterval) {
			clearInterval(globalThis.__tokenRefreshInterval);
		}

		const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
		const MAX_RETRIES = 2;
		let consecutiveFailures = 0;

		globalThis.__tokenRefreshInterval = setInterval(async () => {
			const sessionManager = this.getSessionManager();
			if (!sessionManager.isAuthenticated()) {
				clearInterval(globalThis.__tokenRefreshInterval);
				globalThis.__tokenRefreshInterval = undefined;
				return;
			}

			if (!navigator.onLine) return;

			try {
				logger.debug('Background token refresh triggered');
				const authService = getAuthService();
				// Refresh token is sent automatically via httpOnly cookie
				const result = await authService.refreshToken();
				if (result.success && result.accessToken) {
					localStorage.setItem('access_token', result.accessToken);
					// Note: refresh_token is managed exclusively via httpOnly cookie
					syncService.setAuthToken(result.accessToken);
					logger.debug('Background token refresh successful');
					this.clearSessionExpired();
					consecutiveFailures = 0;
				} else {
					const failureMessage = result.message;
					if (this.isDefinitiveSessionExpiry(failureMessage)) {
						consecutiveFailures++;
						logger.warn(
							`Background token refresh reports expired session (attempt ${consecutiveFailures}/${MAX_RETRIES + 1})`
						);
						if (consecutiveFailures > MAX_RETRIES) {
							this.markSessionExpired('background-refresh-expired');
							consecutiveFailures = 0;
						}
					} else {
						logger.warn('Background token refresh failed for transient reason, skipping session-expired flag update');
						consecutiveFailures = 0;
					}
				}
			} catch (error: unknown) {
				logger.error('Background token refresh failed due to network/runtime error:', error);
				consecutiveFailures = 0;
			}
		}, REFRESH_INTERVAL_MS);
	}

	/**
	 * Clear all auth data
	 */
	private clearAuthData() {
		localStorage.removeItem('access_token');

		// Clear background token refresh interval
		if (globalThis.__tokenRefreshInterval) {
			clearInterval(globalThis.__tokenRefreshInterval);
			globalThis.__tokenRefreshInterval = undefined;
		}

		// Clear session storage as well
		// Note: CryptoManager session storage (TEMP_MASTER_KEY_EXPORT) is NOT cleared here
		// because clearAuthData() may be called without authLogout(). The crypto key
		// is cleaned up by CryptoManager.clearMasterKey() during the logout flow.
	}

	/** Pull fresh data from server and refresh in-memory stores after re-auth. */
	private async refreshAfterReauth(accessToken: string): Promise<void> {
		localStorage.setItem('access_token', accessToken);
		syncService.setAuthToken(accessToken);
		this.clearSessionExpired();
		this.startBackgroundTokenRefresh();

		try {
			await syncService.initialSync();

			// Repair any drifted shadow indexes (post-incident recovery —
			// see shadow-index-reconciler.service.ts). Must run before
			// taskTitleIndex.rebuild() so the index reads corrected values.
			try {
				const { verifyAndRebuildLocalShadowIndexes } = await import(
					'./shadow-index-reconciler.service'
				);
				await verifyAndRebuildLocalShadowIndexes();
			} catch (err) {
				logger.warn('Shadow index reconciliation failed (non-fatal):', err);
			}

			const { refreshDecryptedLists } = await import('$lib/stores/decrypted-lists.store');
			const { refreshDecryptedSubtasks } = await import(
				'$lib/stores/decrypted-subtasks.store'
			);

			await taskListStore.loadLists();
			await Promise.all([refreshDecryptedLists(), refreshDecryptedSubtasks()]);
			await taskTitleIndex.rebuild();

			const { taskCounts } = await import('$lib/stores/task-counts.store');
			taskCounts.refresh();
		} catch {
			// Non-blocking — re-auth succeeded even if sync fails.
			// User can trigger manual sync later.
		}
	}

	/**
	 * Re-authenticate after session expiry — password step.
	 *
	 * Calls /api/auth/login to obtain new tokens. Master key in CryptoManager
	 * is preserved (E2E access kept across session-expiry events).
	 *
	 * If the account has 2FA enabled, the endpoint returns `twoFactorRequired`
	 * without an access token — propagate that so the UI can collect a TOTP
	 * code and call {@link verifyTotpForReauth}.
	 */
	async reAuthenticate(password: string): Promise<ReAuthResult> {
		if (!browser) return { kind: 'error', message: 'Not in browser' };

		const credentials = localStorage.getItem('reborn_auth_credentials');
		if (!credentials) return { kind: 'error', message: 'Missing credentials' };

		let username: string;
		try {
			const parsed = JSON.parse(credentials);
			username = parsed.user_profile?.username;
			if (!username) return { kind: 'error', message: 'Missing username' };
		} catch {
			return { kind: 'error', message: 'Corrupted credentials' };
		}

		const { PUBLIC_BASE_PATH } = await import('$env/static/public');
		let res: Response;
		try {
			res = await fetch(`${PUBLIC_BASE_PATH}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});
		} catch (err) {
			return {
				kind: 'error',
				message: err instanceof Error ? err.message : 'Network error'
			};
		}

		if (res.status === 429) {
			const retryAfterHeader = res.headers.get('Retry-After');
			const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
			return { kind: 'locked', retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 };
		}

		if (res.status === 401) return { kind: 'invalid_password' };

		let body: ReAuthResponseBody;
		try {
			body = await res.json();
		} catch {
			return { kind: 'error', message: 'Invalid server response' };
		}

		if (!res.ok || !body?.success) return { kind: 'error', message: body?.error };

		const { data } = body;

		if (data?.twoFactorRequired) {
			if (!data.userId)
				return { kind: 'error', message: 'Missing userId in 2FA response' };
			return { kind: 'two_factor_required', userId: data.userId };
		}

		if (!data?.access_token) return { kind: 'error', message: 'Missing access token' };

		await this.refreshAfterReauth(data.access_token);
		return { kind: 'ok' };
	}

	/**
	 * Re-authenticate after session expiry — TOTP step (invoked from
	 * ReAuthModal after {@link reAuthenticate} returned `two_factor_required`).
	 */
	async verifyTotpForReauth(userId: string, code: string): Promise<ReAuthResult> {
		if (!browser) return { kind: 'error', message: 'Not in browser' };

		const { PUBLIC_BASE_PATH } = await import('$env/static/public');
		let res: Response;
		try {
			res = await fetch(`${PUBLIC_BASE_PATH}/api/auth/2fa/verify`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId, code })
			});
		} catch (err) {
			return {
				kind: 'error',
				message: err instanceof Error ? err.message : 'Network error'
			};
		}

		if (res.status === 429) {
			const retryAfterHeader = res.headers.get('Retry-After');
			const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
			return { kind: 'locked', retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 };
		}

		let body: ReAuthResponseBody;
		try {
			body = await res.json();
		} catch {
			return { kind: 'error', message: 'Invalid server response' };
		}

		if (!res.ok || !body?.success) {
			if (res.status === 400) return { kind: 'invalid_totp' };
			return { kind: 'error', message: body?.error };
		}

		const { data } = body;
		if (!data?.access_token) return { kind: 'error', message: 'Missing access token' };

		await this.refreshAfterReauth(data.access_token);
		return { kind: 'ok' };
	}

	/**
	 * Extract user ID from localStorage credentials
	 */
	private getUserIdFromCredentials(): string | null {
		try {
			const raw = localStorage.getItem('reborn_auth_credentials');
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			// parsed.id is always "currentUser" (storage key), NOT the user UUID.
			// The real user ID lives in parsed.user_profile.id.
			return parsed?.user_profile?.id || null;
		} catch {
			return null;
		}
	}
}

// Export singleton
export const authOperationsService = new AuthOperationsService();
