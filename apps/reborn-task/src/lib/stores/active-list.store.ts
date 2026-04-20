import { writable } from 'svelte/store';
import type { ListDecrypted } from '@reborn/types';
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';

const logger = createLogger('ActiveListStore');

// Key for localStorage persistence
const ACTIVE_LIST_KEY = 'reborn-task-active-list';

// Create the active list store with persistence
function createActiveListStore() {
	// Initialize with null or from localStorage
	let initialValue: ListDecrypted | null = null;
	
	if (browser) {
		try {
			const stored = localStorage.getItem(ACTIVE_LIST_KEY);
			if (stored) {
				initialValue = JSON.parse(stored);
				logger.debug('Restored active list from localStorage:', initialValue);
			}
		} catch (error: unknown) {
			logger.error('Failed to restore active list from localStorage:', error);
		}
	}
	
	// Keep track of current value
	let currentValue: ListDecrypted | null = initialValue;
	
	const { subscribe, set } = writable<ListDecrypted | null>(initialValue);
	
	return {
		subscribe,
		
		/**
		 * Set the active list and persist to localStorage
		 */
		set: (list: ListDecrypted | null) => {
			// Only update if the value is actually changing
			if (currentValue?.id === list?.id) {
				logger.debug('Skipping set - value unchanged:', list?.id);
				return;
			}
			
			logger.debug('Setting active list:', list);
			if (import.meta.env.DEV) {
				logger.debug('[ActiveListStore] Set called from:', new Error().stack);
			}
			
			// Update internal tracking
			currentValue = list;
			
			// Update store
			set(list);
			
			if (browser) {
				try {
					if (list) {
						localStorage.setItem(ACTIVE_LIST_KEY, JSON.stringify(list));
						logger.debug('Persisted active list to localStorage:', list);
					} else {
						localStorage.removeItem(ACTIVE_LIST_KEY);
						logger.debug('Cleared active list from localStorage');
					}
				} catch (error: unknown) {
					logger.error('Failed to persist active list to localStorage:', error);
				}
			}
		},
		
		/**
		 * Clear the active list
		 */
		clear: () => {
			currentValue = null;
			set(null);
			
			if (browser) {
				localStorage.removeItem(ACTIVE_LIST_KEY);
				logger.debug('Cleared active list');
			}
		},
		
		/**
		 * Update the active list if it matches the given ID
		 * Useful for syncing changes when a list is updated
		 */
		updateIfMatches: (listId: string, updatedList: ListDecrypted) => {
			if (currentValue?.id === listId) {
				logger.debug('Updating active list:', updatedList);
				
				// Update internal tracking
				currentValue = updatedList;
				
				// Update store
				set(updatedList);
				
				// Persist the update
				if (browser) {
					try {
						localStorage.setItem(ACTIVE_LIST_KEY, JSON.stringify(updatedList));
					} catch (error: unknown) {
						logger.error('Failed to persist updated list:', error);
					}
				}
			}
		}
	};
}

// Export the active list store
export const activeListStore = createActiveListStore();
