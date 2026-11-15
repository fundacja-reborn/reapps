import { writable } from 'svelte/store';
import type { ListDecrypted } from '@reborn/types';
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';

const logger = createLogger('ActiveListStore');

/**
 * localStorage key this store used to persist to. The stored value was the
 * whole decrypted list - its NAME in plaintext, outside the encrypted
 * IndexedDB records. Nothing ever read it back for behaviour (the layout
 * derives the active list from the route), so the store is memory-only now
 * and the old entry is removed on start.
 */
const LEGACY_ACTIVE_LIST_KEY = 'reborn-task-active-list';

function createActiveListStore() {
	if (browser) {
		try {
			localStorage.removeItem(LEGACY_ACTIVE_LIST_KEY);
		} catch (error: unknown) {
			logger.error('Failed to remove the legacy active-list entry:', error);
		}
	}

	// Keep track of current value
	let currentValue: ListDecrypted | null = null;

	const { subscribe, set } = writable<ListDecrypted | null>(null);

	return {
		subscribe,

		/** Set the active list (kept in memory only). */
		set: (list: ListDecrypted | null) => {
			// Only update if the value is actually changing
			if (currentValue?.id === list?.id) {
				return;
			}
			currentValue = list;
			set(list);
		},

		/** Clear the active list. */
		clear: () => {
			currentValue = null;
			set(null);
		},

		/**
		 * Update the active list if it matches the given ID.
		 * Useful for syncing changes when a list is updated.
		 */
		updateIfMatches: (listId: string, updatedList: ListDecrypted) => {
			if (currentValue?.id === listId) {
				currentValue = updatedList;
				set(updatedList);
			}
		}
	};
}

// Export the active list store
export const activeListStore = createActiveListStore();
