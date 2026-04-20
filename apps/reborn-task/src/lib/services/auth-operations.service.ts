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
import { createLogger } from '@reborn/utils';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@reborn/i18n';
import type { CryptoManager } from '@reborn/crypto';
import { syncService } from './sync.service';
import { taskTitleIndex } from './task-title-index.svelte';
import { taskListStore } from '$lib/stores/decrypted-lists.store';
import { setLocale } from '$lib/stores/i18n.store';
import { sessionExpired } from '$lib/stores/session-expired.store';

const logger = createLogger('AuthOperationsService');

// Use globalThis to ensure true singleton across hot reloads
declare global {
	var __authServiceInitialized: boolean | undefined;
	var __sessionManagerInstance: ReturnType<typeof getSessionManager> | undefined;
	var __tokenRefreshInterval: ReturnType<typeof setInterval> | undefined;
}

export class AuthOperationsService {
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
			sessionExpired.set(false);

			return result;
		} catch (error: unknown) {
			logger.error('Login failed:', error);
			throw error;
		}
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
		}

		try {
			await authLogout();
		} finally {
			// Reset session expired flag — this is an intentional logout, not expiry
			sessionExpired.set(false);

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
		sessionExpired.set(false);

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
						// Session expired — re-authenticate with the same password
						logger.info('Session expired after unlock, attempting auto re-authentication');
						const reAuthOk = await this.reAuthenticate(password);
						if (reAuthOk) {
							logger.info('Auto re-authentication successful after unlock');
						} else {
							logger.warn('Auto re-authentication failed after unlock');
						}
					}

					// Wait for the sync that onStorageInit already started.
					// initialSync() returns the in-flight promise so this won't
					// start a second sync — it waits for the existing one.
					await syncService.initialSync();
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
	 * Check if session is valid and restore it
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

			// Check if we already have a valid session
			const sessionManager = this.getSessionManager();
			if (sessionManager.isAuthenticated()) {
				logger.debug('Already authenticated');
				return true;
			}

			logger.debug('Attempting to refresh token...');

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
				return { success: false };
			});

			if (result && result.success && 'accessToken' in result && result.accessToken) {
				logger.debug('Token refresh successful');
				// Update stored access token
				localStorage.setItem('access_token', result.accessToken);
				// Note: refresh_token is managed exclusively via httpOnly cookie

				// IMPORTANT: Update sync service IMMEDIATELY after token refresh
				syncService.setAuthToken(result.accessToken);
				logger.debug('Auth token updated in sync service after refresh');

				// Mark session as initialized and authenticated
				sessionManager.setSession({ isInitialized: true });

				return true;
			}

			// Token refresh failed — mark session as expired but do NOT clear auth data.
			// Tokens may still be valid for a later retry; clearing them would force
			// a full re-login even for transient network errors.
			logger.debug('Token refresh failed, marking session as expired');
			sessionExpired.set(true);

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
	 */
	private async checkE2EStatus() {
		try {
			const { cryptoManager } = await import('@reborn/crypto');

			// Wait for CryptoManager to finish restoring master key from IndexedDB
			await cryptoManager.waitForRestore();

			if (cryptoManager.isInitialized()) {
				logger.info('E2E initialized (master key restored from IndexedDB)');

				// Trigger onStorageInit to ensure stores are initialized.
				// 'restore' context — same user, key loaded from IndexedDB. Do NOT clear data.
				await this.onStorageInit(cryptoManager, 'restore');

				// Update session to reflect E2E status
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

			// Mark session as initialized. If we have tokens, also set isLoading=true
			// so that (app) layout guard waits for the background auth check to complete.
			sessionManager.setSession({ isInitialized: true, isLoading: hasTokens });
			logger.debug('Session marked as initialized', { isLoading: hasTokens });

			// Check if we're offline
			if (!navigator.onLine) {
				logger.info('App is offline');

				// Check for existing tokens and master key
				if (hasTokens) {
					// Mark as authenticated if we have tokens
					sessionManager.setSession({ isAuthenticated: true });
				}

				// Always check E2E status — master key may be in IndexedDB
				await this.checkE2EStatus();

				sessionManager.setLoading(false);

				const authService = getAuthService();
				const hasOffline = await authService.hasOfflineCredentials();
				if (hasOffline) {
					logger.info('Offline credentials available');
				}

				return;
			}

			// Online - try to refresh session in background if tokens exist
			if (hasTokens) {
				logger.debug('Found tokens, attempting to restore session...');

				// Check session without blocking - use Promise.resolve to ensure async execution
				// but don't wait for it to complete
				Promise.resolve().then(async () => {
					try {
						const success = await this.checkSession();
						if (success) {
							logger.debug('Session restored successfully');
							// Check E2E status after successful session restore
							await this.checkE2EStatus();
							// Start background token refresh after successful restore
							this.startBackgroundTokenRefresh();
						} else {
							logger.debug('Session restore failed');
							// Even if session restore failed, check E2E status — master key may be in IndexedDB
							await this.checkE2EStatus();
						}
					} catch (error: unknown) {
						logger.error('Error restoring session:', error);
						// Even on error, check E2E status — master key may be in IndexedDB
						await this.checkE2EStatus();
					} finally {
						sessionManager.setLoading(false);
					}
				});
			} else {
				// No tokens - check for offline credentials
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
					consecutiveFailures = 0;
				} else {
					consecutiveFailures++;
					logger.warn(`Background token refresh unsuccessful (attempt ${consecutiveFailures}/${MAX_RETRIES + 1})`);
					if (consecutiveFailures > MAX_RETRIES) {
						sessionExpired.set(true);
						consecutiveFailures = 0;
					}
				}
			} catch (error: unknown) {
				consecutiveFailures++;
				logger.error(`Background token refresh failed (attempt ${consecutiveFailures}/${MAX_RETRIES + 1}):`, error);
				if (consecutiveFailures > MAX_RETRIES) {
					sessionExpired.set(true);
					consecutiveFailures = 0;
				}
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

	/**
	 * Re-authenticate after session expiry.
	 * Calls login API to obtain new tokens, saves them to localStorage,
	 * but does NOT clear the master key from CryptoManager (preserves E2E access).
	 * Resets sessionExpired flag and triggers a sync.
	 */
	async reAuthenticate(password: string): Promise<boolean> {
		if (!browser) return false;

		const credentials = localStorage.getItem('reborn_auth_credentials');
		if (!credentials) return false;

		let username: string;
		try {
			const parsed = JSON.parse(credentials);
			username = parsed.user_profile?.username;
			if (!username) return false;
		} catch {
			return false;
		}

		try {
			const { PUBLIC_BASE_PATH } = await import('$env/static/public');
			const res = await fetch(`${PUBLIC_BASE_PATH}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});

			const body = await res.json();
			if (!res.ok || !body.success || !body.data?.access_token) return false;

			const { data } = body;

			// Update access token
			localStorage.setItem('access_token', data.access_token);
			// Note: refresh_token is managed exclusively via httpOnly cookie (set by server)

			// Update credentials (keep existing master key + profile)
			try {
				const existing = JSON.parse(credentials);
				localStorage.setItem('reborn_auth_credentials', JSON.stringify(existing));
			} catch {
				/* keep existing */
			}

			// Update sync service auth token
			syncService.setAuthToken(data.access_token);

			// Clear session expired flag
			sessionExpired.set(false);

			// Restart background token refresh
			this.startBackgroundTokenRefresh();

			// Pull fresh data from server and refresh in-memory stores.
			// syncToServer() only pushes local ops — after session expiry we need
			// a full pull so IndexedDB (and the UI) reflect the server state.
			try {
				await syncService.initialSync();

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

			return true;
		} catch {
			return false;
		}
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
