import { ApiClient } from '@reborn/api-client';
import type { UnauthorizedResult } from '@reborn/api-client';
import { TransientRefreshError } from '@reborn/auth';
import { PUBLIC_BASE_PATH } from '$env/static/public';
import { createLogger } from '@reborn/utils';
import type { Logger } from '@reborn/utils';
import { authFetch } from '$lib/utils/auth-fetch';
import { sessionExpired } from '$lib/stores/session-expired.store';

/**
 * Base class for sync services with common functionality
 */
export abstract class SyncBaseService {
	protected apiClient: ApiClient;
	protected logger: Logger;

	constructor(loggerName: string) {
		this.logger = createLogger(loggerName);

		// Use base path prefix for sub-path deployments (e.g. /task/api when PUBLIC_BASE_PATH=/task)
		const baseUrl = `${PUBLIC_BASE_PATH}/api`;
		this.logger.debug('Initializing sync service with base URL:', baseUrl);

		// Create API client. AuthInterceptor adds the Bearer header on each
		// request; `onUnauthorized` plugs into the shared `authFetch.refresh()`
		// so a 401 here transparently triggers a single-flight refresh + retry
		// (cross-tab serialized via Web Locks API). Shorter timeout so a VPN
		// black hole (navigator.onLine=true but no upstream) doesn't hang a
		// sync for the default 30 s.
		//
		// Three-state contract (`UnauthorizedResult`):
		// - `'refreshed'` — new access token → ApiClient retries once,
		// - `'session-expired'` — `/auth/refresh` returned definitive 401/403
		//   → ApiClient surfaces the 401 AND fires `onSessionExpired`, which
		//   flips the `sessionExpired` store so the banner appears. Without
		//   wiring this here, a sync 401 would never trigger the banner — only
		//   direct `authFetch(...)` calls would, leaving sync silently broken
		//   (the bug that motivated this change, observed 2026-05-11).
		// - `'transient'` — `TransientRefreshError` (5xx from nginx during a
		//   Docker rebuild, network error, timeout) → ApiClient surfaces the
		//   401 without flipping the banner; sync retries on the next tick.
		this.apiClient = new ApiClient({
			baseUrl,
			timeout: 15_000,
			onUnauthorized: async (): Promise<UnauthorizedResult> => {
				try {
					const newToken = await authFetch.refresh();
					return newToken !== null ? 'refreshed' : 'session-expired';
				} catch (err) {
					if (err instanceof TransientRefreshError) return 'transient';
					// Unknown error from the refresh path is safer to treat as
					// transient than as expiry (don't log the user out on a
					// programming bug); rethrowing would also leak from request().
					this.logger.warn('Unexpected refresh error, treating as transient:', err);
					return 'transient';
				}
			},
			onSessionExpired: () => sessionExpired.set(true)
		});
	}

	/**
	 * Retry a function with exponential backoff
	 */
	protected async retryWithBackoff<T>(
		fn: () => Promise<T>,
		maxRetries = 3,
		initialDelay = 1000
	): Promise<T> {
		let lastError: Error | unknown;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await fn();
			} catch (error: unknown) {
				lastError = error;

				if (attempt === maxRetries) {
					this.logger.error(`Failed after ${maxRetries + 1} attempts:`, error);
					throw error;
				}

				// Calculate delay with exponential backoff (1s, 2s, 4s)
				const delay = initialDelay * Math.pow(2, attempt);
				this.logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);

				// Wait before retrying
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		throw lastError;
	}

	/**
	 * Check if error is auth-related
	 */
	protected isAuthError(error: string | undefined): boolean {
		if (!error) return false;
		const lower = error.toLowerCase();
		return (
			lower.includes('401') ||
			lower.includes('403') ||
			lower.includes('unauthorized') ||
			lower.includes('forbidden')
		);
	}

	/**
	 * Handle API response errors
	 */
	protected handleApiError(
		response: { success: boolean; error?: string; message?: string; status?: number },
		entityType: string
	): void {
		if (!response.success) {
			const errorMessage = response.error || response.message;
			if (this.isAuthError(errorMessage) || response.status === 401 || response.status === 403) {
				// ApiClient already attempted a refresh + retry via `onUnauthorized`.
				// On 'session-expired' it also fired `onSessionExpired` → the banner
				// is already up. On 'transient' it left the banner alone — sync will
				// retry on the next tick. Either way, give up this entity pull
				// silently here so we don't double-signal the user.
				this.logger.info(
					`${entityType} sync skipped — session refresh failed, awaiting re-authentication.`
				);
				return;
			}
			throw new Error(errorMessage || `Failed to fetch ${entityType}`);
		}
	}
}
