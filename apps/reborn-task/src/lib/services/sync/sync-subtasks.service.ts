import { SyncBaseService } from './sync-base.service';
import { subtaskStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import type {
	SubtaskEncrypted,
	SubtaskStoredLocal,
	SubtaskSensitiveMetadata,
	StorageOfflineOperation
} from '@reborn/types';

/**
 * Service responsible for syncing subtasks
 */
export class SyncSubtasksService extends SyncBaseService {
	constructor() {
		super('SyncSubtasksService');
	}

	/**
	 * Retry with backoff - public wrapper for use by orchestrator
	 */
	async retryWithBackoff<T>(
		fn: () => Promise<T>,
		maxRetries?: number,
		initialDelay?: number
	): Promise<T> {
		return super.retryWithBackoff(fn, maxRetries, initialDelay);
	}

	/**
	 * Sync subtasks from server
	 */
	async syncSubtasks(): Promise<void> {
		try {
			// Fetch subtasks from server
			const response = await this.apiClient.get<SubtaskEncrypted[]>('subtasks');

			this.handleApiError(response, 'subtasks');
			if (!response.success) return;

			// Log the full response for debugging
			this.logger.debug('Subtasks API response:', response);

			// Handle empty or null data
			const subtasks = response.data || [];
			this.logger.info(`Fetched ${subtasks.length} subtasks from server`);

			// Save each subtask to IndexedDB with rebuilt shadow indexes
			for (const subtask of subtasks) {
				try {
					// Check if local subtask has pending changes — don't overwrite
					const localSubtask = await subtaskStore.get(subtask.id);
					if (localSubtask && localSubtask.sync_status === 'pending') {
						this.logger.debug(
							`Skipping pull for subtask ${subtask.id} — has pending local changes`
						);
						continue;
					}

					// Compare sync_version — skip if server is not newer
					const serverVersion = subtask.sync_version ?? 0;
					if (localSubtask && serverVersion <= (localSubtask.sync_version ?? 0)) {
						continue;
					}

					const withShadow = await this.rebuildShadowIndexes({
						...subtask,
						sync_status: 'synced',
						last_sync_at: new Date().toISOString(),
						deleted_at: subtask.deleted_at || null,
						sync_version: serverVersion
					});
					await subtaskStore.save(withShadow);
				} catch (error: unknown) {
					this.logger.error(`Failed to save subtask ${subtask.id}:`, error);
				}
			}
		} catch (error: unknown) {
			this.logger.error('Failed to sync subtasks:', error);
			// Don't throw - partial sync is better than no sync
		}
	}

	/**
	 * Rebuild local shadow indexes from encrypted metadata.
	 */
	private async rebuildShadowIndexes(subtask: SubtaskEncrypted): Promise<SubtaskStoredLocal> {
		try {
			if (subtask.metadata_encrypted && cryptoManager.isInitialized()) {
				const meta = await cryptoManager.decryptObject<SubtaskSensitiveMetadata>(
					subtask.metadata_encrypted
				);
				return {
					...subtask,
					is_completed: meta.is_completed ? 1 : 0
				} as SubtaskStoredLocal;
			}
		} catch (error: unknown) {
			this.logger.warn(
				`Failed to decrypt metadata for subtask ${subtask.id}, using defaults`,
				error
			);
		}

		return {
			...subtask,
			is_completed: 0
		} as SubtaskStoredLocal;
	}

	/**
	 * Sync a single subtask operation
	 */
	async syncSubtaskOperation(operation: StorageOfflineOperation): Promise<void> {
		const subtaskData = operation.data as SubtaskEncrypted;

		switch (operation.type) {
			case 'create': {
				// Create subtask on server
				const createResponse = await this.apiClient.post<SubtaskEncrypted>('subtasks', subtaskData);
				if (!createResponse.success) {
					throw new Error(createResponse.error || 'Failed to create subtask');
				}

				// Update local subtask with server response
				if (createResponse.data) {
					const withShadow = await this.rebuildShadowIndexes({
						...createResponse.data,
						sync_status: 'synced',
						last_sync_at: new Date().toISOString()
					});
					await subtaskStore.save(withShadow);
				}
				break;
			}

			case 'update': {
				// Update subtask on server
				const updateResponse = await this.apiClient.put<SubtaskEncrypted>(
					`subtasks/${subtaskData.id}`,
					subtaskData
				);
				if (!updateResponse.success) {
					throw new Error(updateResponse.error || 'Failed to update subtask');
				}

				// Update local subtask with server's sync_version
				if (updateResponse.data) {
					const withShadow = await this.rebuildShadowIndexes({
						...updateResponse.data,
						sync_status: 'synced',
						last_sync_at: new Date().toISOString()
					});
					await subtaskStore.save(withShadow);
				}
				break;
			}

			case 'delete': {
				// Delete subtask on server
				const deleteResponse = await this.apiClient.delete(`subtasks/${subtaskData.id}`);
				if (!deleteResponse.success) {
					throw new Error(deleteResponse.error || 'Failed to delete subtask');
				}
				break;
			}
		}
	}
}
