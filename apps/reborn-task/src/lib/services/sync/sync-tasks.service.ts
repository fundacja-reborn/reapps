import { SyncBaseService } from './sync-base.service';
import { rebuildShadowIndexes } from './shadow-indexes';
import { ensureOperationOk } from './operation-error';
import { taskStore } from '@reborn/storage';
import type {
	TaskEncrypted,
	TaskEncryptedBooleans,
	StorageOfflineOperation
} from '@reborn/types';

/**
 * Service responsible for syncing tasks
 */
export class SyncTasksService extends SyncBaseService {
	constructor() {
		super('SyncTasksService');
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
	 * Sync tasks from server
	 * @returns Number of tasks updated from server (newer than local)
	 */
	async syncTasks(): Promise<number> {
		let serverUpdates = 0;
		try {
			// First, get pending delete operations to avoid re-creating deleted tasks
			const pendingDeletes = await this.getPendingDeleteOperations();

			// Get IDs of tasks with any pending operations in the queue
			// This replaces the old sync_status === 'pending' check which could leave
			// "orphaned" tasks permanently blocked after a successful push
			const pendingTaskOps = await this.getPendingTaskOperations();

			// Get all locally deleted tasks to prevent UI flicker
			const allLocalTasks = await taskStore.getAll();
			const locallyDeletedTaskIds = new Set(
				allLocalTasks.filter((task) => task.deleted_at !== null).map((task) => task.id)
			);
			this.logger.debug(
				`Found ${locallyDeletedTaskIds.size} locally deleted tasks to preserve during sync`
			);

			// Fetch active (non-deleted) tasks from server
			const response = await this.apiClient.get<TaskEncrypted[]>('tasks');

			this.handleApiError(response, 'tasks');
			if (!response.success) return 0;

			// Log the full response for debugging
			this.logger.debug('Tasks API response:', response);

			// Handle empty or null data
			const tasks = response.data || [];
			this.logger.info(`Fetched ${tasks.length} active tasks from server`);

			// Save each task to IndexedDB
			for (const task of tasks) {
				try {
					// Skip if task has pending delete operation
					if (pendingDeletes.has(task.id)) {
						this.logger.debug(`Skipping sync for task ${task.id} - has pending delete operation`);
						continue;
					}

					// CRITICAL: Skip if task is locally in trash
					// This prevents UI flicker during sync when soft deletes haven't synced yet
					if (locallyDeletedTaskIds.has(task.id)) {
						this.logger.debug(`Skipping sync for task ${task.id} - task is in trash locally`);
						continue;
					}

					// Check if there's a local version with pending changes
					const localTask = await taskStore.get(task.id);

					// If task has pending operations in the queue, don't overwrite with server data
					if (localTask && pendingTaskOps.has(task.id)) {
						this.logger.debug(`Skipping sync for task ${task.id} - has pending operations in queue`);
						continue;
					}

					// A task whose push was permanently rejected (sync_error) was
					// dead-lettered out of the queue, so pendingTaskOps no longer guards
					// it. Skip it anyway: it still holds the user's local edit (e.g. a
					// too-large description), so a newer server version must not silently
					// clobber it. The user resolves it by shrinking the task, which
					// re-queues a push. See guideline 36, rule 14.
					if (localTask && localTask.sync_status === 'sync_error') {
						this.logger.debug(`Skipping sync for task ${task.id} - has unsynced sync_error edit`);
						continue;
					}

					// Check if task was permanently deleted locally (not in IndexedDB but not in pending deletes)
					// This handles the case where permanent delete succeeded locally but failed on server
					if (!localTask) {
						// Task doesn't exist locally - check if it was recently deleted
						// by looking for failed permanent delete operations
						const hasFailedDelete = await this.hasFailedPermanentDelete(task.id);
						if (hasFailedDelete) {
							this.logger.debug(
								`Skipping sync for task ${task.id} - was permanently deleted locally`
							);
							continue;
						}
					}

					// Check if this is an orphaned recurring instance
					// (task with parent_task_id pointing to non-existent template)
					if (task.parent_task_id) {
						const template = await taskStore.get(task.parent_task_id);
						if (!template) {
							this.logger.warn(
								`Skipping orphaned recurring instance ${task.id} - template ${task.parent_task_id} not found`
							);
							// Mark this orphaned instance for permanent deletion on server
							await this.queueOrphanedInstanceCleanup(task.id);
							continue;
						}
					}

					// Check if task is soft-deleted locally but active on server
					// This can happen if soft-delete hasn't synced yet
					if (localTask && localTask.deleted_at && !task.deleted_at) {
						// Check if there's a pending update operation for soft delete
						const hasPendingSoftDelete = await this.hasPendingSoftDelete(task.id);
						if (hasPendingSoftDelete) {
							this.logger.debug(`Skipping sync for task ${task.id} - has pending soft delete`);
							continue;
						}

						// IMPORTANT: If local task is in trash but server version is not,
						// preserve the local deleted_at status to avoid UI flicker
						this.logger.debug(
							`Preserving local deleted_at for task ${task.id} - server hasn't synced soft delete yet`
						);
						// Skip this task - it will be properly handled by syncDeletedTasks()
						continue;
					}

					// CRITICAL: Check for recurring instances whose parent is in trash
					// This prevents UI flicker when parent template's soft delete hasn't synced yet
					if (task.parent_task_id && !task.deleted_at) {
						const parentTemplate = await taskStore.get(task.parent_task_id);
						if (parentTemplate && parentTemplate.deleted_at) {
							// Parent is in trash locally, so skip this instance
							// It will be handled properly when syncDeletedTasks() runs
							this.logger.debug(
								`Skipping sync for recurring instance ${task.id} - parent template ${task.parent_task_id} is in trash locally`
							);
							continue;
						}

						// Also check if this specific instance is in trash locally
						if (localTask && localTask.deleted_at) {
							this.logger.debug(
								`Skipping sync for recurring instance ${task.id} - instance is in trash locally`
							);
							continue;
						}
					}

					// If server version is newer, update local
					// BUT: If local task already has deleted_at, don't overwrite unless server has newer data
					if (!localTask || task.sync_version > (localTask.sync_version || 0)) {
						// Additional check: if local task has same deleted_at as server, skip to avoid UI flicker
						if (
							localTask &&
							localTask.deleted_at &&
							task.deleted_at &&
							localTask.deleted_at === task.deleted_at
						) {
							this.logger.debug(`Skipping update for deleted task ${task.id} - already in sync`);
							continue;
						}

						// If local task is deleted and server task is also deleted with same position,
						// check if we really need to update (to prevent UI flicker)
						if (
							localTask &&
							localTask.deleted_at &&
							task.deleted_at &&
							localTask.position === task.position &&
							localTask.title_encrypted === task.title_encrypted
						) {
							this.logger.debug(`Skipping redundant update for deleted task ${task.id}`);
							continue;
						}

						// Detect server-side updates (existing local entity overwritten by newer server data)
						if (localTask && task.sync_version > (localTask.sync_version || 0)) {
							serverUpdates++;
						}
						await this.saveWithShadowIndexes(task);
					}
				} catch (error: unknown) {
					this.logger.error(`Failed to save task ${task.id}:`, error);
				}
			}

			// Also sync deleted tasks (for trash)
			await this.syncDeletedTasks();
		} catch (error: unknown) {
			this.logger.error('Failed to sync tasks:', error);
			// Don't throw - partial sync is better than no sync
		}
		return serverUpdates;
	}

	/**
	 * Check if a task has a pending soft delete operation
	 */
	private async hasPendingSoftDelete(taskId: string): Promise<boolean> {
		try {
			// Import dynamically to avoid circular dependency
			const { offlineOperationsStore } = await import('@reborn/storage');

			// Get all operations for this task
			const allOps = await offlineOperationsStore.getAll();

			// Check for pending update operation with deleted_at
			for (const op of allOps) {
				if (
					op.type === 'update' &&
					op.entityType === 'task' &&
					op.entityId === taskId &&
					(op.status === 'pending' || op.status === 'failed') &&
					op.data &&
					typeof op.data === 'object' &&
					op.data !== null &&
					'deleted_at' in op.data &&
					op.data.deleted_at !== null
				) {
					return true;
				}
			}

			return false;
		} catch (error: unknown) {
			this.logger.error('Failed to check for pending soft delete:', error);
			return false;
		}
	}

	/**
	 * Check if a task has a failed permanent delete operation
	 */
	private async hasFailedPermanentDelete(taskId: string): Promise<boolean> {
		try {
			// Import dynamically to avoid circular dependency
			const { offlineOperationsStore } = await import('@reborn/storage');

			// Get all operations for this task
			const allOps = await offlineOperationsStore.getAll();

			// Check for failed permanent delete operation
			for (const op of allOps) {
				if (
					op.type === 'delete' &&
					op.entityType === 'task' &&
					op.entityId === taskId &&
					op.status === 'failed' &&
					op.data &&
					typeof op.data === 'object' &&
					op.data !== null &&
					'permanent' in op.data &&
					op.data.permanent === true
				) {
					return true;
				}
			}

			return false;
		} catch (error: unknown) {
			this.logger.error('Failed to check for failed permanent delete:', error);
			return false;
		}
	}

	/**
	 * Get IDs of tasks that have pending delete operations
	 */
	private async getPendingDeleteOperations(): Promise<Set<string>> {
		try {
			// Import dynamically to avoid circular dependency
			const { offlineOperationsStore } = await import('@reborn/storage');

			// Get all pending operations
			const pendingOps = await offlineOperationsStore.getAll();

			// Filter for delete operations on tasks
			const deleteTaskIds = new Set<string>();

			for (const op of pendingOps) {
				if (
					op.type === 'delete' &&
					op.entityType === 'task' &&
					(op.status === 'pending' || op.status === 'failed')
				) {
					deleteTaskIds.add(op.entityId);
				}
			}

			this.logger.debug(`Found ${deleteTaskIds.size} tasks with pending delete operations`);

			return deleteTaskIds;
		} catch (error: unknown) {
			this.logger.error('Failed to get pending delete operations:', error);
			return new Set();
		}
	}

	/**
	 * Get IDs of tasks that have any pending operations (create, update, or delete)
	 * Used to check if a task truly has pending changes, regardless of sync_status field
	 */
	private async getPendingTaskOperations(): Promise<Set<string>> {
		try {
			const { offlineOperationsStore } = await import('@reborn/storage');
			const pendingOps = await offlineOperationsStore.getAll();
			const pendingTaskIds = new Set<string>();

			for (const op of pendingOps) {
				if (
					op.entityType === 'task' &&
					(op.status === 'pending' || op.status === 'failed')
				) {
					pendingTaskIds.add(op.entityId);
				}
			}

			return pendingTaskIds;
		} catch (error: unknown) {
			this.logger.error('Failed to get pending task operations:', error);
			return new Set();
		}
	}

	/**
	 * Sync deleted tasks from server (for trash view)
	 */
	async syncDeletedTasks(): Promise<void> {
		try {
			// First, get pending delete operations to avoid re-creating deleted tasks
			const pendingDeletes = await this.getPendingDeleteOperations();

			// Get IDs of tasks with any pending operations in the queue
			const pendingTaskOps = await this.getPendingTaskOperations();

			// Get all locally deleted templates to check their instances
			const allLocalTasks = await taskStore.getAll();
			const deletedTemplateIds = new Set(
				allLocalTasks.filter((task) => task.is_template && task.deleted_at).map((task) => task.id)
			);

			// Fetch deleted tasks from server
			const response = await this.apiClient.get<TaskEncrypted[]>('tasks?include_deleted=true');

			this.handleApiError(response, 'deleted tasks');
			if (!response.success) return;

			// Handle empty or null data
			const deletedTasks = response.data || [];
			this.logger.info(`Fetched ${deletedTasks.length} deleted tasks from server`);

			// Save each deleted task to IndexedDB
			for (const task of deletedTasks) {
				try {
					// Skip if task has pending delete operation
					if (pendingDeletes.has(task.id)) {
						this.logger.debug(
							`Skipping sync for deleted task ${task.id} - has pending delete operation`
						);
						continue;
					}

					// Check if there's a local version with pending changes
					const localTask = await taskStore.get(task.id);

					// If task has pending operations in the queue, don't overwrite with server data
					if (localTask && pendingTaskOps.has(task.id)) {
						this.logger.debug(
							`Skipping sync for deleted task ${task.id} - has pending operations in queue`
						);
						continue;
					}

					// Permanently-rejected (dead-lettered) task: keep the local edit.
					if (localTask && localTask.sync_status === 'sync_error') {
						this.logger.debug(
							`Skipping sync for deleted task ${task.id} - has unsynced sync_error edit`
						);
						continue;
					}

					// CRITICAL: Check if this is an instance of a locally deleted template
					// This ensures all instances stay in trash if template is in trash
					if (task.parent_task_id && deletedTemplateIds.has(task.parent_task_id)) {
						// Ensure the instance is also marked as deleted
						if (!task.deleted_at) {
							task.deleted_at = new Date().toISOString();
							this.logger.debug(
								`Marking recurring instance ${task.id} as deleted - parent template ${task.parent_task_id} is in trash`
							);
						}
					}

					// If server version is newer, update local
					// BUT: Avoid unnecessary saves that cause UI flicker
					if (!localTask || task.sync_version > (localTask.sync_version || 0)) {
						// Skip if local task is already in same state as server task
						if (
							localTask &&
							localTask.deleted_at === task.deleted_at &&
							localTask.position === task.position &&
							localTask.title_encrypted === task.title_encrypted &&
							localTask.description_encrypted === task.description_encrypted
						) {
							this.logger.debug(`Skipping redundant save for deleted task ${task.id} - no changes`);
							continue;
						}

						await this.saveWithShadowIndexes(task);
					}
				} catch (error: unknown) {
					this.logger.error(`Failed to save deleted task ${task.id}:`, error);
				}
			}
		} catch (error: unknown) {
			this.logger.error('Failed to sync deleted tasks:', error);
			// Don't throw - partial sync is better than no sync
		}
	}

	/**
	 * Queue cleanup for orphaned recurring instance
	 */
	private async queueOrphanedInstanceCleanup(taskId: string): Promise<void> {
		try {
			// Import dynamically to avoid circular dependency
			const { addOperation } = await import('@reborn/storage');

			// Queue permanent delete operation for orphaned instance
			await addOperation({
				type: 'delete',
				entityType: 'task',
				entityId: taskId,
				data: { id: taskId, permanent: true }
			});

			this.logger.info('Queued orphaned instance for permanent deletion', { taskId });
		} catch (error: unknown) {
			this.logger.error('Failed to queue orphaned instance cleanup:', error);
			// Don't throw - this is a cleanup operation
		}
	}

	/**
	 * Wrap {@link rebuildShadowIndexes} and persist to IDB. If the rebuild throws
	 * (crypto not ready or decrypt failed), log a warn and skip the save —
	 * server ciphertext is unchanged so the next successful sync will retry.
	 */
	private async saveWithShadowIndexes(task: TaskEncrypted): Promise<void> {
		let prepared: TaskEncryptedBooleans;
		try {
			prepared = await rebuildShadowIndexes(task);
		} catch (error: unknown) {
			this.logger.warn(
				`Skipping save of task ${task.id} — shadow indexes could not be derived. ` +
					`Will retry on next successful sync.`,
				error
			);
			return;
		}
		await taskStore.save(prepared);
	}

	/**
	 * Sync a single task operation
	 * @returns The task response from server for create operations, void for others
	 */
	async syncTaskOperation(operation: StorageOfflineOperation): Promise<TaskEncrypted | void> {
		const taskData = operation.data as TaskEncrypted;

		switch (operation.type) {
			case 'create': {
				// Create task on server
				const createResponse = await this.apiClient.post<TaskEncrypted>('tasks', taskData);
				// Permanent 4xx (413/400/403) -> PermanentOperationError; the queue
				// dead-letters the op and marks the task sync_error. Transient -> plain
				// Error, left in the queue as today.
				ensureOperationOk(createResponse, 'POST /api/tasks');

				// Update local task with server response
				if (createResponse.data) {
					await this.saveWithShadowIndexes(createResponse.data);
					// Return the response so it can be processed further if needed
					return createResponse.data;
				}
				break;
			}

			case 'update': {
				// Update task on server
				const updateResponse = await this.apiClient.put<TaskEncrypted>(
					`tasks/${taskData.id}`,
					taskData
				);
				ensureOperationOk(updateResponse, `PUT /api/tasks/${taskData.id}`);

				// Save server response to IndexedDB (resets sync_status, updates sync_version)
				if (updateResponse.data) {
					await this.saveWithShadowIndexes(updateResponse.data);
				}
				break;
			}

			case 'delete': {
				// Check if this is a permanent delete by looking for the 'permanent' flag
				const isPermanentDelete = 'permanent' in taskData && taskData.permanent === true;
				const isTemplate = 'is_template' in taskData && taskData.is_template === 1;

				// Skip template deletion sync - templates are auto-cleaned by server
				// when all their instances are deleted
				if (isTemplate) {
					this.logger.debug('Skipping template deletion sync - auto-cleaned by server', {
						taskId: taskData.id
					});
					// Remove from local store if it still exists
					const localTask = await taskStore.get(taskData.id);
					if (localTask) {
						await taskStore.delete(taskData.id);
					}
					return;
				}

				if (isPermanentDelete) {
					// Permanent delete - use the permanent endpoint
					const deleteResponse = await this.apiClient.delete(`tasks/${taskData.id}/permanent`);

					// Handle 404 as success - task is already deleted on server
					if (!deleteResponse.success && deleteResponse.status === 404) {
						// For templates, this is expected behavior - they might be auto-cleaned by server
						if (isTemplate) {
							this.logger.debug('Template not found on server (404), already cleaned up', {
								taskId: taskData.id,
								isTemplate: true
							});
						} else {
							// For regular tasks, log with more detail but still treat as success
							this.logger.debug('Task not found on server (404), treating as success', {
								taskId: taskData.id,
								error: deleteResponse.error
							});
						}
						// Remove from local store if it still exists
						const localTask = await taskStore.get(taskData.id);
						if (localTask) {
							await taskStore.delete(taskData.id);
						}
						// Treat as successful sync
						return;
					}

					// For other errors, throw (404 already handled as success above).
					ensureOperationOk(deleteResponse, `DELETE /api/tasks/${taskData.id}/permanent`);
				} else {
					// This shouldn't happen anymore as soft deletes are handled as updates
					// But keep it for backward compatibility with old operations
					this.logger.warn('Unexpected delete operation without permanent flag', { taskData });
					const deleteResponse = await this.apiClient.delete(`tasks/${taskData.id}`);
					ensureOperationOk(deleteResponse, `DELETE /api/tasks/${taskData.id}`);
				}
				break;
			}
		}
	}
}
