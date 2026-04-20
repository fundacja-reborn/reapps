import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { loadUserMasterKey, clearMasterKey, isMasterKeyLoaded } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';

const logger = createLogger('CryptoStore');

// Store for crypto state
const cryptoState = writable({
	isInitialized: false,
	isLoading: false,
	error: null as string | null
});

// Derived stores
export const isCryptoInitialized = derived(cryptoState, $state => $state.isInitialized);
export const isCryptoLoading = derived(cryptoState, $state => $state.isLoading);
export const cryptoError = derived(cryptoState, $state => $state.error);

/**
 * Initialize crypto with user's encrypted master key
 * @param encryptedMasterKey - Encrypted master key from server
 * @param masterKeySalt - Salt used for key derivation
 * @param password - User's password
 * @returns Promise<boolean> - True if successful
 */
export async function initializeCrypto(
	encryptedMasterKey: string,
	masterKeySalt: string,
	password: string
): Promise<boolean> {
	if (!browser) return false;
	
	cryptoState.update(state => ({ ...state, isLoading: true, error: null }));
	
	try {
		// Load the master key
		const success = await loadUserMasterKey(encryptedMasterKey, masterKeySalt, password);
		
		if (success) {
			logger.info('Crypto initialized successfully');
			cryptoState.update(state => ({ 
				...state, 
				isInitialized: true, 
				isLoading: false 
			}));
			return true;
		} else {
			logger.error('Failed to initialize crypto');
			cryptoState.update(state => ({ 
				...state, 
				isInitialized: false, 
				isLoading: false,
				error: 'Failed to decrypt master key. Please check your password.'
			}));
			return false;
		}
	} catch (error: unknown) {
		logger.error('Error initializing crypto:', error);
		cryptoState.update(state => ({ 
			...state, 
			isInitialized: false, 
			isLoading: false,
			error: 'An error occurred while initializing encryption.'
		}));
		return false;
	}
}

/**
 * Clear crypto state on logout
 */
export function clearCrypto() {
	clearMasterKey();
	cryptoState.set({
		isInitialized: false,
		isLoading: false,
		error: null
	});
	logger.info('Crypto state cleared');
}

/**
 * Check if crypto is ready
 */
export function checkCryptoReady(): boolean {
	return browser && isMasterKeyLoaded();
}

// Export the main store for direct access if needed
export { cryptoState };
