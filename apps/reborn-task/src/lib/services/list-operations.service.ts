import { get } from 'svelte/store';
import { listStore, taskStore, listDeleteOps, listBatchOps } from '@reborn/storage';
import { createLogger } from '@reborn/utils';
import { activeListStore } from '$lib/stores/active-list.store';

const logger = createLogger('ListOperationsService');

export const MAX_LIST_NAME_LENGTH = 50;

/**
 * Service for handling complex list operations that involve multiple stores
 */
export class ListOperationsService {
	/** Mutex: prevents concurrent ensureDefaultList() calls from creating duplicates */
	private _ensureDefaultListPromise: Promise<string> | null = null;
	/**
	 * Update list properties (name)
	 * @param listId - ID listy do aktualizacji
	 * @param updates - Obiekt z polami do aktualizacji (obecnie tylko name)
	 * @returns Promise<void>
	 * @throws {Error} Jeśli lista nie istnieje lub aktualizacja się nie powiedzie
	 */
	async updateList(listId: string, updates: { name?: string }): Promise<void> {
		try {
			const list = await listStore.get(listId);
			if (!list) {
				throw new Error('List not found');
			}

			// Przygotuj obiekt aktualizacji
			const updatedList = { ...list };

			// Aktualizuj nazwę jeśli podana
			if (updates.name !== undefined) {
				if (!updates.name.trim()) {
					throw new Error('List name cannot be empty');
				}
				if (updates.name.trim().length > MAX_LIST_NAME_LENGTH) {
					throw new Error(`List name cannot exceed ${MAX_LIST_NAME_LENGTH} characters`);
				}

				// Szyfruj nową nazwę
				const { cryptoManager } = await import('@reborn/crypto');
				if (!cryptoManager.isInitialized()) {
					throw new Error('CryptoManager is not initialized');
				}

				updatedList.name_encrypted = await cryptoManager.encryptText(updates.name.trim());
			}

			// Aktualizuj timestamp
			updatedList.updated_at = new Date().toISOString();
			updatedList.sync_version = (updatedList.sync_version || 0) + 1;
			updatedList.sync_status = 'pending';

			// Zapisz zaktualizowaną listę
			await listStore.save(updatedList);

			// Sync activeListStore if this list is currently active
			if (updates.name !== undefined) {
				const currentActive = get(activeListStore);
				if (currentActive?.id === listId) {
					activeListStore.updateIfMatches(listId, { ...currentActive, name: updates.name.trim() });
				}
			}

			// Dodaj operację offline do synchronizacji
			const { addOperation } = await import('@reborn/storage');
			await addOperation({
				type: 'update',
				entityType: 'task_list',
				entityId: listId,
				data: updatedList
			});

			// Schedule immediate sync
			const { syncService } = await import('./sync.service');
			syncService.scheduleSyncSoon();

			logger.info('List updated', { listId, updates });
		} catch (error: unknown) {
			logger.error('Failed to update list', { listId, updates, error });
			throw error;
		}
	}

	/**
	 * Set a list as default for the user
	 * @param listId - ID listy do ustawienia jako domyślna
	 * @returns Promise<void>
	 * @throws {Error} Jeśli lista nie istnieje lub operacja się nie powiedzie
	 */
	async setDefaultList(listId: string): Promise<void> {
		try {
			const list = await listStore.get(listId);
			if (!list) {
				throw new Error('List not found');
			}

			// Użyj metody z listBatchOps
			await listBatchOps.setDefault(listId, list.user_id);

			logger.info('Default list updated', { listId });
		} catch (error: unknown) {
			logger.error('Failed to set default list', { listId, error });
			throw error;
		}
	}

	/**
	 * Delete a list with different strategies for handling tasks
	 * @param listId - ID of the list to delete
	 * @param deleteMode - 'with-tasks' to delete all tasks, 'move-tasks' to move them to another list
	 * @param targetListId - Target list ID when using 'move-tasks' mode
	 */
	async deleteList(
		listId: string,
		deleteMode: 'with-tasks' | 'move-tasks',
		targetListId?: string
	): Promise<void> {
		try {
			const list = await listStore.get(listId);
			if (!list) {
				throw new Error('List not found');
			}

			if (list.is_default) {
				throw new Error('Cannot delete default list');
			}

			if (deleteMode === 'with-tasks') {
				// Delete all tasks in this list first
				const tasks = await taskStore.query('task_list_id', listId);
				if (tasks.length > 0) {
					await taskStore.deleteMany(tasks.map((t) => t.id));
					logger.info('Deleted tasks from list', { listId, taskCount: tasks.length });
				}

				// Then hard delete the list
				await listDeleteOps.hardDelete(listId);
				logger.info('List and tasks deleted', { listId });
			} else if (deleteMode === 'move-tasks' && targetListId) {
				// Validate target list exists
				const targetList = await listStore.get(targetListId);
				if (!targetList) {
					throw new Error('Target list not found');
				}

				// Move all tasks to target list
				const tasks = await taskStore.query('task_list_id', listId);
				if (tasks.length > 0) {
					const updatedTasks = tasks.map((task) => ({
						...task,
						task_list_id: targetListId,
						updated_at: new Date().toISOString()
					}));
					await taskStore.saveMany(updatedTasks);
					logger.info('Moved tasks to new list', {
						fromListId: listId,
						toListId: targetListId,
						taskCount: tasks.length
					});
				}

				// Delete the list
				await listDeleteOps.hardDelete(listId);
				logger.info('List deleted after moving tasks', { listId });
			}
		} catch (error: unknown) {
			logger.error('Failed to delete list', { listId, deleteMode, error });
			throw error;
		}
	}

	/**
	 * Create a default list for user if none exists
	 */
	async ensureDefaultList(userId: string): Promise<string> {
		// Mutex: if another call is already in progress, wait for it
		if (this._ensureDefaultListPromise) {
			return this._ensureDefaultListPromise;
		}

		this._ensureDefaultListPromise = this._doEnsureDefaultList(userId).finally(() => {
			this._ensureDefaultListPromise = null;
		});

		return this._ensureDefaultListPromise;
	}

	private async _doEnsureDefaultList(userId: string): Promise<string> {
		try {
			// Check if user has a default list
			const lists = await listStore.query('user_id', userId);
			const defaultList = lists.find((l) => l.is_default);

			if (defaultList) {
				return defaultList.id;
			}

			// If user has lists but no default, set the first one as default
			if (lists.length > 0) {
				await listBatchOps.setDefault(lists[0].id, userId);
				logger.info('Set first list as default', { listId: lists[0].id, userId });
				return lists[0].id;
			}

			// No lists at all — create a default list
			logger.info('No lists found for user, creating default list', { userId });
			const { cryptoManager } = await import('@reborn/crypto');
			if (!cryptoManager.isInitialized()) {
				throw new Error('CryptoManager is not initialized');
			}

			const { t } = await import('$lib/stores/i18n.store');
			const { get } = await import('svelte/store');
			const $t = get(t);
			const defaultListName = $t('taskList.default') || 'My Tasks';

			const name_encrypted = await cryptoManager.encryptText(defaultListName);
			const now = new Date().toISOString();

			const newList = {
				id: crypto.randomUUID(),
				user_id: userId,
				name_encrypted,
				created_at: now,
				updated_at: now,
				is_default: true,
				deleted_at: null,
				order_index: 0,
				sync_version: 1,
				sync_status: 'pending' as const
			};

			await listStore.save(newList);

			// Queue offline operation for sync
			const { addOperation } = await import('@reborn/storage');
			await addOperation({
				type: 'create',
				entityType: 'task_list',
				entityId: newList.id,
				data: newList
			});

			// Schedule sync
			try {
				const { syncService } = await import('./sync.service');
				syncService.scheduleSyncSoon();
			} catch {
				// Sync scheduling is non-critical
			}

			logger.info('Created default list', { userId, listId: newList.id });
			return newList.id;
		} catch (error: unknown) {
			logger.error('Failed to ensure default list', { userId, error });
			throw error;
		}
	}

	/**
	 * Get list statistics (task counts)
	 */
	async getListStatistics(listId: string): Promise<ListStatistics> {
		try {
			const tasks = await taskStore.query('task_list_id', listId);
			const activeTasks = tasks.filter((t) => !t.deleted_at);
			const completedTasks = activeTasks.filter((t) => t.is_completed);
			const starredTasks = activeTasks.filter((t) => t.is_starred);

			return {
				totalTasks: activeTasks.length,
				completedTasks: completedTasks.length,
				pendingTasks: activeTasks.length - completedTasks.length,
				starredTasks: starredTasks.length
			};
		} catch (error: unknown) {
			logger.error('Failed to get list statistics', { listId, error });
			throw error;
		}
	}

	/**
	 * Create a new encrypted list for the user (Zero Knowledge)
	 * @param userId - ID użytkownika
	 * @param name - Nazwa listy (jawna, do zaszyfrowania)
	 * @returns ID nowo utworzonej listy
	 * @throws {Error} Jeśli nie uda się utworzyć listy
	 */
	async createList(userId: string, name: string): Promise<string> {
		try {
			if (!name.trim()) {
				throw new Error('List name is required');
			}
			if (name.trim().length > MAX_LIST_NAME_LENGTH) {
				throw new Error(`List name cannot exceed ${MAX_LIST_NAME_LENGTH} characters`);
			}
			// Szyfruj nazwę listy lokalnie (Zero Knowledge)
			const { cryptoManager } = await import('@reborn/crypto');
			if (!cryptoManager.isInitialized()) {
				throw new Error('CryptoManager is not initialized');
			}
			const name_encrypted = await cryptoManager.encryptText(name.trim());
			// Przygotuj nową listę zgodnie z modelem ListEncrypted
			const newList = {
				id: crypto.randomUUID(),
				user_id: userId,
				name_encrypted,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				is_default: false,
				deleted_at: null,
				order_index: 0,
				sync_version: 1,
				sync_status: 'pending' as const
			};
			await listStore.save(newList);
			// Dodaj operację offline do synchronizacji
			const { addOperation } = await import('@reborn/storage');
			await addOperation({
				type: 'create',
				entityType: 'task_list',
				entityId: newList.id,
				data: newList
			});
			logger.info('Created new list', { userId, listId: newList.id });
			return newList.id;
		} catch (error: unknown) {
			logger.error('Failed to create list', { userId, name, error });
			throw error;
		}
	}
}

// Export singleton instance
export const listOperationsService = new ListOperationsService();

// Types
interface ListStatistics {
	totalTasks: number;
	completedTasks: number;
	pendingTasks: number;
	starredTasks: number;
}
