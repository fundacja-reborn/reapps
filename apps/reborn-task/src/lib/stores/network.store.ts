import { derived } from 'svelte/store';
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';
import { syncService } from '$lib/services/sync.service';
import {
	connectivity,
	connectivityStore,
	isOnline as connectivityIsOnline,
	checkOnline as checkConnectivityOnline
} from './connectivity.store';

const logger = createLogger('NetworkStore');

// Re-export the active-probe connectivity store under the legacy `isOnline`
// name. `navigator.onLine` lies under an active VPN tunnel (e.g. Proton in
// airplane mode) so we back this with a real HTTP probe — see
// `connectivity.store.ts`.
export const isOnline = connectivityIsOnline;

// Trigger sync on offline → online transitions, matching the old
// `window.addEventListener('online')` handler.
if (browser && connectivityStore) {
	let wasOnline = connectivityStore.getState().status === 'online';
	connectivity.subscribe(($c) => {
		const nowOnline = $c.status === 'online';
		if (nowOnline && !wasOnline) {
			logger.info('Connectivity restored — triggering sync');
			syncService.syncToServer().catch((error) => {
				logger.error('Failed to sync after coming online:', error);
			});
		}
		wasOnline = nowOnline;
	});
}

// Derived store for network status message
export const networkStatus = derived(isOnline, ($isOnline) =>
	$isOnline ? 'Online' : 'Offline'
);

// Synchronous helper, probe-backed.
export const checkOnline = checkConnectivityOnline;

/**
 * Determines if an error is network-related
 * @param error - The error to check
 * @returns true if the error is network-related, false otherwise
 */
export function isNetworkError(error: unknown): boolean {
	// TypeError with 'Failed to fetch' is a common network error
	if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
		return true;
	}
	
	// Handle error-like objects with status property
	const errorObj = error as { status?: number; response?: { status?: number }; message?: string };
	
	// Check for network-related HTTP status codes
	if (errorObj?.status === 0 || // Network failure
		errorObj?.status === 502 || // Bad Gateway
		errorObj?.status === 503 || // Service Unavailable
		errorObj?.status === 504 || // Gateway Timeout
		errorObj?.status === 522 || // Connection Timed Out (Cloudflare)
		errorObj?.status === 524) { // A Timeout Occurred (Cloudflare)
		return true;
	}
	
	// Check if the error has a response with network-related status
	if (errorObj?.response?.status === 0 ||
		(errorObj?.response?.status && errorObj.response.status >= 502 && errorObj.response.status <= 504)) {
		return true;
	}
	
	// Check for common network error messages
	const errorMessage = errorObj?.message?.toLowerCase() || '';
	if (errorMessage.includes('network') ||
		errorMessage.includes('fetch') ||
		errorMessage.includes('connection') ||
		errorMessage.includes('timeout') ||
		errorMessage.includes('offline')) {
		return true;
	}
	
	// Check if error is from navigator.onLine being false during operation
	if (browser && !navigator.onLine) {
		return true;
	}
	
	return false;
}
