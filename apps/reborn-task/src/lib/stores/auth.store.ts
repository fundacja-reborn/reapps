import { writable, derived, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { createSessionStore } from '@reborn/auth';
import { getSessionManager } from '$lib/auth';
import type { AuthSession, ReactiveStore } from '@reborn/auth';
import { createLogger } from '@reborn/utils';

const logger = createLogger('AuthStore');

// Helper function to create Svelte-compatible store
function createSvelteStore<T>(initialValue: T): ReactiveStore<T> {
	const store = writable(initialValue);
	return store as ReactiveStore<T>;
}

// Create mock session for SSR
const mockSession = writable<AuthSession>({
	isAuthenticated: false,
	isInitialized: false,
	hasE2E: false,
	user: null,
	error: null,
	isLoading: false,
	isLoggingOut: false
});

// Create lazy session store that initializes on first access
let _sessionStore: Readable<AuthSession> | null = null;

function getOrCreateSessionStore(): Readable<AuthSession> {
	if (!browser) {
		return mockSession;
	}

	// Return existing store if already created
	if (_sessionStore) {
		return _sessionStore;
	}

	// Create a writable store that will be updated when session manager is ready
	const store = writable<AuthSession>({
		isAuthenticated: false,
		isInitialized: false,
		hasE2E: false,
		user: null,
		error: null,
		isLoading: false,
		isLoggingOut: false
	});

	// Helper: try to get SessionManager from module export or globalThis fallback
	// (globalThis survives Vite HMR module re-evaluation)
	function tryGetSessionManager(): import('@reborn/auth').SessionManager | null {
		try {
			return getSessionManager();
		} catch {
			// Module-level variable may be null after HMR — check globalThis fallback
			const global = globalThis as Record<string, unknown>;
			if (global.__sessionManagerInstance) {
				return global.__sessionManagerInstance as import('@reborn/auth').SessionManager;
			}
			return null;
		}
	}

	function connectToSessionManager(sm: import('@reborn/auth').SessionManager): void {
		const realStore = createSessionStore(sm, createSvelteStore) as unknown as Readable<AuthSession>;
		realStore.subscribe((value) => {
			store.set(value);
		});
		logger.debug('Session store connected to session manager');
	}

	// Try to initialize immediately if possible
	let connected = false;
	const sm = tryGetSessionManager();
	if (sm) {
		connectToSessionManager(sm);
		connected = true;
	} else {
		logger.debug('Session manager not ready on first attempt, will retry');
	}

	// Retry periodically until session manager is available (only if initial attempt failed)
	if (!connected) {
		let retryCount = 0;
		const maxRetries = 30;
		const retryInterval = setInterval(() => {
			const sessionMgr = tryGetSessionManager();
			if (sessionMgr) {
				connectToSessionManager(sessionMgr);
				clearInterval(retryInterval);
			} else {
				retryCount++;
				if (retryCount >= maxRetries) {
					clearInterval(retryInterval);
					// Mark as initialized to unblock UI
					store.set({
						isAuthenticated: false,
						isInitialized: true,
						hasE2E: false,
						user: null,
						error: null,
						isLoading: false,
						isLoggingOut: false
					});
					logger.warn('Failed to connect to session manager after retries');
				}
			}
		}, 100);
	}

	_sessionStore = store;
	return store;
}

// Main session store - lazy initialization
export const session: Readable<AuthSession> = getOrCreateSessionStore();

// Derived stores for convenience
export const isAuthenticated = derived(session, ($s) => $s?.isAuthenticated ?? false);
export const hasE2E = derived(session, ($s) => $s?.hasE2E ?? false);
export const user = derived(session, ($s) => $s?.user ?? null);
export const isLoading = derived(session, ($s) => $s?.isLoading ?? false);
export const error = derived(session, ($s) => $s?.error ?? null);
export const isInitialized = derived(session, ($s) => $s?.isInitialized ?? false);
export const isLoggingOut = derived(session, ($s) => $s?.isLoggingOut ?? false);

// Export only stores, no functions!
// All operations should go through authOperationsService
