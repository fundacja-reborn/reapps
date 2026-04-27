import { ApiClient } from '@reborn/api-client';
import { PUBLIC_BASE_PATH } from '$env/static/public';
import { createLogger } from '@reborn/utils';
import type { Logger } from '@reborn/utils';
import { authFetch } from '$lib/utils/auth-fetch';

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
		this.apiClient = new ApiClient({
			baseUrl,
			timeout: 15_000,
			onUnauthorized: async () => (await authFetch.refresh()) !== null
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
				// ApiClient already attempted a refresh + retry via `onUnauthorized`,
				// and `authFetch` flipped `sessionExpired` on failure. If we still see
				// a 401/403 here, the user must re-authenticate — give up the entity
				// pull silently so the SessionExpiredBanner is the only signal.
				this.logger.info(
					`${entityType} sync skipped — session refresh failed, awaiting re-authentication.`
				);
				return;
			}
			throw new Error(errorMessage || `Failed to fetch ${entityType}`);
		}
	}
}
