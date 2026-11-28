import { browser } from '$app/environment';
import { API_BASE } from '$lib/utils/api-base';
import { cryptoManager } from '@reborn/crypto';
import { AuthService, SessionManager } from '@reborn/auth';
import { AuthStorageAdapter } from './adapters/authStorage';
import { AuthApiAdapter } from './adapters/authApi';
import { createLogger } from '@reborn/utils';
import type { CryptoManager } from '@reborn/crypto';

const logger = createLogger('AuthServiceInstance');

// Survive Vite HMR module re-evaluation: restore from globalThis if available
declare global {
	var __authServiceInstance: AuthService | undefined;
	var __sessionManagerInstance: SessionManager | undefined;
}

let authService: AuthService | null = globalThis.__authServiceInstance ?? null;
let sessionManager: SessionManager | null = globalThis.__sessionManagerInstance ?? null;

/**
 * Initialize the auth service (should be called once on app start)
 */
export function initializeAuthService(
	onStorageInit?: (
		cryptoManager: CryptoManager,
		context: 'login' | 'restore'
	) => Promise<void>,
	onLanguageChange?: (language: string) => void
): { authService: AuthService; sessionManager: SessionManager } {
	if (!browser) {
		throw new Error('Auth service can only be initialized in browser environment');
	}

	if (!authService || !sessionManager) {
		// Create session manager
		sessionManager = new SessionManager();

		// Create adapters
		const storage = new AuthStorageAdapter();
		const apiClient = new AuthApiAdapter(import.meta.env.VITE_API_URL || API_BASE);

		// Create auth service
		authService = new AuthService(
			cryptoManager,
			sessionManager,
			storage,
			apiClient,
			onStorageInit,
			onLanguageChange
		);

		// Persist to globalThis so refs survive HMR module re-evaluation
		globalThis.__authServiceInstance = authService;
		globalThis.__sessionManagerInstance = sessionManager;

		logger.info('Auth service initialized');
	}

	return { authService, sessionManager };
}

/**
 * Get auth service instance
 */
export function getAuthService(): AuthService {
	if (!authService) {
		throw new Error('Auth service not initialized. Call initializeAuthService first.');
	}
	return authService;
}

/**
 * Get session manager instance
 */
export function getSessionManager(): SessionManager {
	if (!sessionManager) {
		throw new Error('Session manager not initialized. Call initializeAuthService first.');
	}
	return sessionManager;
}

/**
 * Export convenience functions
 */
export async function login(username: string, password: string) {
	const service = getAuthService();
	return service.login(username, password);
}

export async function register(username: string, password: string, preferredLanguage?: string) {
	const service = getAuthService();
	return service.register(username, password, preferredLanguage);
}

export async function logout(skipApiCall = false) {
	const service = getAuthService();
	try {
		return await service.logout(skipApiCall);
	} finally {
		// Native App Lock off on every logout (also logout-all and account
		// deletion, which come through here): the master key and the vault are
		// cleared, so an armed gate would strand the next account on a biometric
		// screen with no key behind it. Re-enabling is one tap after the next
		// login. A no-op flag write on the web. Same as re/notes' logout.
		cryptoManager.setAppLockEnabled(false);
	}
}

export async function unlockE2E(password: string) {
	const service = getAuthService();
	return service.unlockE2E(password);
}

export async function tryOfflineLogin(password: string) {
	const service = getAuthService();
	return service.tryOfflineLogin(password);
}

export async function hasOfflineCredentials() {
	const service = getAuthService();
	return service.hasOfflineCredentials();
}
