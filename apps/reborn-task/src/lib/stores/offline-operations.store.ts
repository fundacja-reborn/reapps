import { derived } from 'svelte/store';
import { offlineOperationsStore as storageOfflineOps } from '@reborn/storage';
import type { StorageOfflineOperation } from '@reborn/types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('OfflineOperationsStore');

/**
 * Reactive store for offline operations - wraps the storage package store
 * This provides a reactive interface for UI components
 */
export const offlineOperations = derived(
	storageOfflineOps.items,
	$operations => $operations
);

/**
 * Derived store for pending operations
 */
export const pendingOperations = derived(
	offlineOperations,
	$operations => $operations.filter(op => op.status === 'pending' || !op.status)
);

/**
 * Derived store for failed operations
 */
export const failedOperations = derived(
	offlineOperations,
	$operations => $operations.filter(op => op.status === 'failed')
);

/**
 * Utility functions for offline operations
 */
export const offlineOperationsStore = {
	/**
	 * Remove an operation - delegates to storage package
	 */
	async removeOperation(id: string) {
		logger.debug('Removing offline operation:', id);
		return await storageOfflineOps.delete(id);
	},

	/**
	 * Update operation status - delegates to storage package
	 */
	async updateOperationStatus(id: string, status: StorageOfflineOperation['status'], error?: string) {
		logger.debug('Updating operation status:', { id, status, error });
		const operation = await storageOfflineOps.get(id);
		
		if (operation) {
			operation.status = status;
			operation.updated_at = Date.now();
			if (error) {
				operation.error = error;
				operation.last_error_time = Date.now();
				operation.retryCount = (operation.retryCount || 0) + 1;
			}
			await storageOfflineOps.save(operation);
		}
	},

	/**
	 * Get pending operations synchronously from current store value
	 */
	getPendingOperations(): StorageOfflineOperation[] {
		let operations: StorageOfflineOperation[] = [];
		storageOfflineOps.items.subscribe(value => {
			operations = value.filter(op => op.status === 'pending' || !op.status);
		})();
		return operations;
	},

	/**
	 * Load operations from IndexedDB
	 */
	async loadOperations() {
		logger.debug('Loading offline operations...');
		await storageOfflineOps.refreshItems(); // poprawka: refreshFromDB -> refreshItems
	},

	/**
	 * Clear all operations
	 */
	async clearAll() {
		logger.info('Clearing all offline operations');
		await storageOfflineOps.clear();
	},

	/**
	 * Get all operations
	 */
	async getAll(): Promise<StorageOfflineOperation[]> {
		return await storageOfflineOps.getAll();
	}
};

// Don't load operations on initialization - wait for explicit call after DB init
// This prevents errors when the store is imported before database initialization
