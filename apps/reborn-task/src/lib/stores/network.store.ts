import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';
import { syncService } from '$lib/services/sync.service';

const logger = createLogger('NetworkStore');

// Create online/offline status store
function createNetworkStore() {
	const { subscribe, set } = writable(browser ? navigator.onLine : true);
	
	if (browser) {
		// Set up event listeners
		const handleOnline = () => {
			logger.info('Network status: Online');
			set(true);
			
			// Trigger sync when coming back online
			logger.info('Triggering sync after coming online');
			syncService.syncToServer().catch(error => {
				logger.error('Failed to sync after coming online:', error);
			});
		};
		
		const handleOffline = () => {
			logger.info('Network status: Offline');
			set(false);
		};
		
		// Add event listeners
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
		
		// Clean up on unload
		window.addEventListener('beforeunload', () => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
		});
	}
	
	return {
		subscribe
	};
}

// Export the store
export const isOnline = createNetworkStore();

// Derived store for network status message
export const networkStatus = derived(
	isOnline,
	$isOnline => $isOnline ? 'Online' : 'Offline'
);

// Helper to check if we're online
export function checkOnline(): boolean {
	return browser ? navigator.onLine : true;
}

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
