import { taskStore, addOperation, taskQueries } from '@reborn/storage';
import { createLogger } from '@reborn/utils';
import { taskCounts } from '$lib/stores/task-counts.store';
import { tick } from 'svelte';
import type { TaskEncryptedBooleans, TaskEncrypted } from '@reborn/types';
import { taskIndex } from './task-title-index.svelte';
import { syncService } from './sync.service';

const logger = createLogger('TrashManagementService');

export class TrashManagementService {
	/**
	 * Restore a task from trash by clearing its deleted_at timestamp
	 */
	async restoreTask(taskId: string): Promise<void> {
		try {
			// Get the task from store
			const task = await taskStore.get(taskId);
			if (!task) {
				throw new Error('Task not found');
			}

			if (!task.deleted_at) {
				throw new Error('Task is not in trash');
			}

			// Restore by clearing deleted_at
			const restoredTask: TaskEncryptedBooleans = {
				...task,
				deleted_at: null,
				updated_at: new Date().toISOString(),
				sync_status: 'pending' as const
			};

			// Save to IndexedDB
			await taskStore.save(restoredTask);

			// Restore in index
			taskIndex.patch(taskId, {
				isDeleted: false,
				deletedAt: null,
				updatedAt: restoredTask.updated_at
			});

			// Register offline operation for sync
			await addOperation({
				type: 'update',
				entityType: 'task',
				entityId: restoredTask.id,
				data: this.convertToApiFormat(restoredTask)
			});
			syncService.scheduleSyncSoon();

			// Update counts
			await taskCounts.refresh();
			await tick();

			logger.info('Task restored successfully', { taskId });
		} catch (error: unknown) {
			logger.error('Failed to restore task:', error);
			throw error;
		}
	}

	/**
	 * Check and clean up orphaned recurring task template
	 */
	async checkAndCleanupOrphanedTemplate(templateId: string): Promise<void> {
		try {
			// Get all instances of this template
			const instances = await taskQueries.instancesOfTemplate(templateId);

			// Filter out deleted instances
			const activeInstances = instances.filter((instance) => !instance.deleted_at);

			logger.info('Checking for orphaned template', {
				templateId,
				totalInstances: instances.length,
				activeInstances: activeInstances.length
			});

			// If no active instances remain, delete the template
			if (activeInstances.length === 0) {
				logger.info('No active instances remaining - deleting orphaned template', { templateId });

				// Get the template
				const template = await taskStore.get(templateId);
				if (template && template.is_template) {
					// Templates should be permanently deleted when orphaned
					// They are not visible to users and shouldn't appear in trash
					// No need to soft-delete first - API now allows direct permanent deletion of templates

					// Permanently delete it directly
					await taskStore.delete(templateId);

					// Register offline operation for permanent delete
					// Mark as template deletion for special handling during sync
					await addOperation({
						type: 'delete',
						entityType: 'task',
						entityId: templateId,
						data: {
							id: templateId,
							permanent: true,
							is_template: true // Flag to indicate this is a template
						}
					});
					syncService.scheduleSyncSoon();

					logger.info('Orphaned template permanently deleted', { templateId });
				}
			}
		} catch (error: unknown) {
			logger.error('Failed to cleanup orphaned template:', error);
			// Don't throw - this is a cleanup operation, shouldn't break the main flow
		}
	}

	/**
	 * Permanently delete a task from the database
	 */
	async permanentlyDeleteTask(taskId: string): Promise<void> {
		try {
			// Get the task to ensure it exists and is in trash
			const task = await taskStore.get(taskId);
			if (!task) {
				throw new Error('Task not found');
			}

			if (!task.deleted_at) {
				throw new Error('Task is not in trash - use soft delete first');
			}

			// Check if this is a recurring task instance
			const parentTemplateId = task.parent_task_id;

			// Permanently delete from IndexedDB
			await taskStore.delete(taskId);

			// Remove from index
			taskIndex.remove(taskId);

			// Register offline operation for permanent delete
			// Send minimal data to distinguish from soft delete
			await addOperation({
				type: 'delete',
				entityType: 'task',
				entityId: taskId,
				data: { id: taskId, permanent: true } // Add 'permanent' flag
			});
			syncService.scheduleSyncSoon();

			// Update counts
			await taskCounts.refresh();
			await tick();

			logger.info('Task permanently deleted', { taskId });

			// If this was a recurring task instance, check if template should be cleaned up
			if (parentTemplateId) {
				logger.info('Task was a recurring instance - checking template for cleanup', {
					instanceId: taskId,
					templateId: parentTemplateId
				});
				await this.checkAndCleanupOrphanedTemplate(parentTemplateId);
			}
		} catch (error: unknown) {
			logger.error('Failed to permanently delete task:', error);
			throw error;
		}
	}

	/**
	 * Empty trash by permanently deleting all tasks in trash
	 */
	async emptyTrash(): Promise<void> {
		try {
			// Get all tasks from store
			const allTasks = await taskStore.getAll();

			// Filter tasks in trash
			const trashedTasks = allTasks.filter((task) => task.deleted_at !== null);

			logger.info('Emptying trash', { taskCount: trashedTasks.length });

			// Collect unique template IDs that might need cleanup
			const templateIdsToCheck = new Set<string>();

			// Delete each task
			for (const task of trashedTasks) {
				// If this is a recurring instance, track its template
				if (task.parent_task_id) {
					templateIdsToCheck.add(task.parent_task_id);
				}

				// Delete the task (without template cleanup to avoid redundant checks)
				await this.permanentlyDeleteTaskWithoutTemplateCheck(task.id);
			}

			// Now check all templates that had instances deleted
			for (const templateId of templateIdsToCheck) {
				await this.checkAndCleanupOrphanedTemplate(templateId);
			}

			// Update counts and UI after all deletions
			await taskCounts.refresh();
			await tick();

			logger.info('Trash emptied successfully');
		} catch (error: unknown) {
			logger.error('Failed to empty trash:', error);
			throw error;
		}
	}

	/**
	 * Permanently delete a task without checking for orphaned templates
	 * Used internally by emptyTrash to avoid redundant checks
	 */
	private async permanentlyDeleteTaskWithoutTemplateCheck(taskId: string): Promise<void> {
		try {
			// Get the task to ensure it exists
			const task = await taskStore.get(taskId);
			if (!task) {
				return; // Already deleted
			}

			// Permanently delete from IndexedDB
			await taskStore.delete(taskId);

			// Remove from index
			taskIndex.remove(taskId);

			// Register offline operation for permanent delete
			await addOperation({
				type: 'delete',
				entityType: 'task',
				entityId: taskId,
				data: { id: taskId, permanent: true }
			});
			syncService.scheduleSyncSoon();
		} catch (error: unknown) {
			logger.error('Failed to delete task:', error);
			// Don't throw - continue with other deletions
		}
	}

	/**
	 * Automatically purge old tasks from trash (>30 days)
	 * This should be called on app startup
	 */
	async purgeOldTasks(): Promise<number> {
		try {
			// Get all tasks from store
			const allTasks = await taskStore.getAll();

			// Filter tasks that are in trash and older than 30 days
			const now = new Date();
			const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

			const oldTrashedTasks = allTasks.filter((task) => {
				if (!task.deleted_at) return false;
				const deletedDate = new Date(task.deleted_at);
				return deletedDate < thirtyDaysAgo;
			});

			logger.info('Purging old tasks from trash', {
				taskCount: oldTrashedTasks.length,
				olderThan: thirtyDaysAgo.toISOString()
			});

			// Delete each old task
			for (const task of oldTrashedTasks) {
				await this.permanentlyDeleteTask(task.id);
			}

			logger.info('Old tasks purged successfully', { purgedCount: oldTrashedTasks.length });

			return oldTrashedTasks.length;
		} catch (error: unknown) {
			logger.error('Failed to purge old tasks:', error);
			throw error;
		}
	}

	/**
	 * Get statistics about trash
	 */
	async getTrashStats(): Promise<{
		totalInTrash: number;
		dueForAutoPurge: number;
		oldestDeletedAt: Date | null;
	}> {
		try {
			const allTasks = await taskStore.getAll();
			const trashedTasks = allTasks.filter((task) => task.deleted_at !== null);

			const now = new Date();
			const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

			const dueForAutoPurge = trashedTasks.filter((task) => {
				const deletedDate = new Date(task.deleted_at!);
				return deletedDate < thirtyDaysAgo;
			}).length;

			let oldestDeletedAt: Date | null = null;
			if (trashedTasks.length > 0) {
				const oldestTask = trashedTasks.reduce((oldest, task) => {
					const taskDate = new Date(task.deleted_at!);
					const oldestDate = new Date(oldest.deleted_at!);
					return taskDate < oldestDate ? task : oldest;
				});
				oldestDeletedAt = new Date(oldestTask.deleted_at!);
			}

			return {
				totalInTrash: trashedTasks.length,
				dueForAutoPurge,
				oldestDeletedAt
			};
		} catch (error: unknown) {
			logger.error('Failed to get trash stats:', error);
			return {
				totalInTrash: 0,
				dueForAutoPurge: 0,
				oldestDeletedAt: null
			};
		}
	}

	/**
	 * Strip local-only shadow indexes before sending to server.
	 */
	private convertToApiFormat(task: TaskEncryptedBooleans): TaskEncrypted {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional destructure to strip shadow indexes
		const { is_completed, is_starred, is_recurring, due_date, ...wire } = task;
		return {
			...wire,
			is_template: (task.is_template ? 1 : 0) as 0 | 1
		};
	}
}

// Export singleton instance
export const trashManagementService = new TrashManagementService();
