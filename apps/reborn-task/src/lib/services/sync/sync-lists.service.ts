import { SyncBaseService } from './sync-base.service';
import { ensureOperationOk } from './operation-error';
import { listStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import type { ListEncrypted, StorageOfflineOperation } from '@reborn/types';
import { taskListStore } from '$lib/stores/decrypted-lists.store';
import { t } from '$lib/stores/i18n.store';
import { get } from 'svelte/store';

/**
 * Service responsible for syncing task lists
 */
export class SyncListsService extends SyncBaseService {
	constructor() {
		super('SyncListsService');
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
	 * Sync task lists from server
	 * @returns Number of lists updated from server (newer than local)
	 */
	async syncLists(): Promise<number> {
		let serverUpdates = 0;
		try {
			// Fetch lists from server
			const response = await this.apiClient.get<ListEncrypted[]>('tasklists');

			this.handleApiError(response, 'task lists');
			if (!response.success) return 0;

			// Log the full response for debugging
			this.logger.debug('Task lists API response:', response);

			// Handle empty or null data
			const lists = response.data || [];
			this.logger.info(`Fetched ${lists.length} lists from server`);

			if (lists.length === 0) {
				this.logger.info('No lists found on server, creating default list');
				await this.createDefaultList();
				return 0;
			}

			// Save each list to IndexedDB — skip entities with pending local changes
			for (const list of lists) {
				try {
					const localList = await listStore.get(list.id);
					// 'sync_error' = a permanently-rejected (dead-lettered) local edit;
					// keep it for the same reason as 'pending' - don't clobber it.
					if (localList?.sync_status === 'pending' || localList?.sync_status === 'sync_error') {
						this.logger.debug(`Skipping list ${list.id} — unsynced local changes exist`);
						continue;
					}
					// Detect server-side updates (existing local entity overwritten by newer server data)
					if (localList && list.sync_version > (localList.sync_version || 0)) {
						serverUpdates++;
					}
					this.logger.debug(`Saving list ${list.id} to IndexedDB:`, list);
					// Data from server is already synced
					await listStore.save(list);
					this.logger.debug(`Successfully saved list ${list.id}`);
				} catch (error: unknown) {
					this.logger.error(`Failed to save list ${list.id}:`, error);
				}
			}

			// Load lists into the store after sync
			try {
				this.logger.debug('Loading lists into taskListStore after sync');
				await taskListStore.loadLists();
				this.logger.debug('Lists loaded into taskListStore successfully');
			} catch (loadError) {
				this.logger.error('Failed to load lists into taskListStore:', loadError);
			}
		} catch (error: unknown) {
			this.logger.error('Failed to sync task lists:', error);
			// Don't throw - we want to continue with tasks even if lists fail
		}
		return serverUpdates;
	}

	/**
	 * Create a default list for new users
	 */
	private async createDefaultList(): Promise<void> {
		try {
			this.logger.info('Creating default list for new user');

			// Create encrypted list data
			const $t = get(t);
			const defaultListName = $t('taskList.default') || 'My Tasks';
			const nameEncrypted = await cryptoManager.encryptText(defaultListName);
			const now = new Date().toISOString();

			const defaultList = {
				id: crypto.randomUUID(),
				user_id: '', // Will be set by server
				name_encrypted: nameEncrypted,
				order_index: 0,
				is_default: true,
				created_at: now,
				updated_at: now,
				deleted_at: null,
				sync_version: 0,
				// Fields for frontend compatibility
				sync_status: 'pending' as const,
				last_sync_at: null,
				device_id: undefined
			} satisfies ListEncrypted;

			// Save to IndexedDB
			await listStore.save(defaultList);

			// Sync to server
			try {
				const response = await this.apiClient.post<ListEncrypted>('tasklists', defaultList);

				if (response.success && response.data) {
					// Update with server response (might have different ID)
					await listStore.save(response.data);
				}
			} catch (apiError: unknown) {
				this.logger.warn('API call failed for default list, queuing offline operation:', apiError);
				// Queue for later sync — list is already in IndexedDB
				const { addOperation } = await import('@reborn/storage');
				await addOperation({
					type: 'create',
					entityType: 'task_list',
					entityId: defaultList.id,
					data: defaultList
				});
			}

			// Reload lists into store
			await taskListStore.loadLists();
		} catch (error: unknown) {
			this.logger.error('Failed to create default list:', error);
		}
	}

	/**
	 * Sync a single task list operation
	 */
	async syncListOperation(operation: StorageOfflineOperation): Promise<void> {
		const listData = operation.data as ListEncrypted;

		switch (operation.type) {
			case 'create': {
				// Create list on server
				const createResponse = await this.apiClient.post<ListEncrypted>('tasklists', listData);
				ensureOperationOk(createResponse, 'POST /api/tasklists');

				// Update local list with server response (might have different ID or timestamps)
				if (createResponse.data) {
					await listStore.save(createResponse.data);
				}
				break;
			}

			case 'update': {
				// Update list on server
				const updateResponse = await this.apiClient.put<ListEncrypted>(
					`tasklists/${listData.id}`,
					listData
				);
				ensureOperationOk(updateResponse, `PUT /api/tasklists/${listData.id}`);
				// Mark local entity as synced so the next pull doesn't skip it
				await listStore.save({ ...listData, sync_status: 'synced' });
				break;
			}

			case 'delete': {
				// Check if there's additional metadata for delete operation
				let deleteBody = undefined;

				// If the operation has additional metadata (like deleteMode)
				if (typeof operation.data === 'object' && operation.data !== null) {
					const data = operation.data as Record<string, unknown>;
					if (data.deleteMode) {
						deleteBody = {
							deleteMode: data.deleteMode,
							targetListId: data.targetListId
						};
					}
				}

				// Delete list on server with optional body
				const deleteResponse = deleteBody
					? await this.apiClient.delete(`tasklists/${listData.id}`, deleteBody)
					: await this.apiClient.delete(`tasklists/${listData.id}`);

				ensureOperationOk(deleteResponse, `DELETE /api/tasklists/${listData.id}`);
				break;
			}
		}
	}
}
