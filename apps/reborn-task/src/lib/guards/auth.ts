import { browser } from '$app/environment';
import { base } from '$app/paths';
import { goto } from '$lib/utils/navigation';
import { get } from 'svelte/store';
import { session } from '$lib/stores/auth.store';
import { createLogger } from '@reborn/utils';
import type { AuthSession } from '@reborn/auth';

const logger = createLogger('AuthGuard');

// Track ongoing redirects to prevent loops
let isRedirecting = false;
let redirectCount = 0;
const MAX_REDIRECTS = 3;

export interface AuthGuardOptions {
	requireE2E?: boolean;
	redirectTo?: string;
	returnTo?: string;
}

/**
 * Auth guard to protect routes
 * @param options - Guard options
 * @returns true if access is allowed, false otherwise
 */
export async function authGuard(options: AuthGuardOptions = {}): Promise<boolean> {
	const { requireE2E = true, redirectTo = '/auth/login', returnTo } = options;

	if (!browser) {
		// Always allow on server side
		return true;
	}

	// Prevent redirect loops
	if (isRedirecting) {
		logger.debug('Already redirecting, skipping auth guard');
		return false;
	}

	// Check if we've hit the redirect limit
	if (redirectCount >= MAX_REDIRECTS) {
		logger.error('Maximum redirects reached, stopping to prevent loop');
		redirectCount = 0; // Reset for next attempt
		return false;
	}

	const currentSession = get(session) as AuthSession;

	// Only log once per second to avoid spam
	const now = Date.now();
	if (!authGuard.lastLog || now - authGuard.lastLog > 1000) {
		logger.debug('Checking auth guard:', {
			isAuthenticated: currentSession.isAuthenticated,
			hasE2E: currentSession.hasE2E,
			requireE2E
		});
		authGuard.lastLog = now;
	}

	// Check if we're already on the target page to prevent redirect loops
	const currentPath = window.location.pathname;

	// Local-only / no-account mode is a valid, usable state: the app is encrypted
	// and functional without a server session, so it must pass the guard. The E2E
	// check below still applies (hasE2E is true once the local key is loaded).
	if (currentSession.isLocalOnly) {
		redirectCount = 0;
		return true;
	}

	// Check if user is authenticated
	if (!currentSession.isAuthenticated) {
		// Don't redirect if already on login page
		if (
			currentPath.startsWith(`${base}/auth/login`) ||
			currentPath.startsWith('/auth/login') ||
			currentPath.startsWith(`${base}/auth/register`) ||
			currentPath.startsWith('/auth/register')
		) {
			return true;
		}

		logger.debug('User not authenticated, redirecting to:', redirectTo);
		let targetUrl = redirectTo;
		try {
			if (returnTo) {
				// Build URL safely without using URL constructor
				targetUrl = `${redirectTo}?returnTo=${encodeURIComponent(returnTo)}`;
			}
			isRedirecting = true;
			redirectCount++;
			await goto(targetUrl);
		} catch (error: unknown) {
			logger.error('Failed to navigate:', error);
			// Fallback to window.location if goto fails
			if (browser) {
				window.location.href = targetUrl || redirectTo;
			}
		} finally {
			// Reset flag after navigation completes
			setTimeout(() => {
				isRedirecting = false;
				// Reset redirect count after successful navigation
				if (redirectCount > 0) redirectCount--;
			}, 500);
		}
		return false;
	}

	// Check if E2E is required and available
	if (requireE2E && !currentSession.hasE2E) {
		// Don't redirect if already on unlock page
		if (currentPath.startsWith(`${base}/auth/unlock`) || currentPath.startsWith('/auth/unlock')) {
			return true;
		}

		logger.debug('E2E required but not available, redirecting to unlock');
		let unlockUrl = '/auth/unlock';
		try {
			if (returnTo) {
				// Build URL safely without using URL constructor
				unlockUrl = `/auth/unlock?returnTo=${encodeURIComponent(returnTo)}`;
			}
			isRedirecting = true;
			redirectCount++;
			await goto(unlockUrl);
		} catch (error: unknown) {
			logger.error('Failed to navigate:', error);
			// Fallback to window.location if goto fails
			if (browser) {
				window.location.href = unlockUrl;
			}
		} finally {
			// Reset flag after navigation completes
			setTimeout(() => {
				isRedirecting = false;
				// Reset redirect count after successful navigation
				if (redirectCount > 0) redirectCount--;
			}, 500);
		}
		return false;
	}

	// Reset redirect count on successful auth check
	redirectCount = 0;
	return true;
}

// Add property to track last log time
authGuard.lastLog = 0;

// Reset redirect count periodically to prevent accumulation
if (browser) {
	setInterval(() => {
		if (redirectCount > 0 && !isRedirecting) {
			redirectCount = 0;
		}
	}, 30000); // Reset every 30 seconds if not actively redirecting
}
