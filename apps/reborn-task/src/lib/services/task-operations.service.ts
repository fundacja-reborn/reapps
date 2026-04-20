import { taskStore, addOperation, taskQueries } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import type {
	TaskDecrypted,
	TaskEncryptedBooleans,
	TaskEncrypted,
	TaskSensitiveMetadata,
	BooleanInt
} from '@reborn/types';
import { taskCounts } from '$lib/stores/task-counts.store';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { user } from '$lib/stores/auth.store';
import { recurrenceService } from './recurrence.service';
import { taskIndex } from './task-title-index.svelte';
import { syncService } from './sync.service';

const logger = createLogger('TaskOperationsService');

export class TaskOperationsService {
	/**
	 * Cache for deleted tasks to enable undo functionality
	 */
	private deletedTasksCache = new Map<string, TaskEncryptedBooleans>();

	/**
	 * Creates a new task with full business logic validation
	 */
	async createTask(data: Partial<TaskDecrypted>, listId: string): Promise<string> {
		try {
			// Business validation
			if (!data.title?.trim()) {
				throw new Error('Tytuł zadania jest wymagany');
			}

			if (!listId) {
				throw new Error('ID listy jest wymagane');
			}

			// Check if CryptoManager is initialized
			if (!cryptoManager.isInitialized()) {
				throw new Error('CryptoManager nie jest zainicjalizowany');
			}

			// Encrypt text fields
			const titleEncrypted = await cryptoManager.encryptText(data.title);
			// Always encrypt description, even if empty, to ensure consistency
			const descriptionEncrypted =
				data.description !== undefined
					? await cryptoManager.encryptText(data.description)
					: undefined;

			// Determine position
			const currentTasks = await taskStore.query('task_list_id', listId);
			const activeTasks = currentTasks.filter((t) => !t.deleted_at);
			const maxPosition = activeTasks.reduce((max, task) => Math.max(max, task.position || 0), 0);
			const newPosition = maxPosition === 0 ? 10000 : maxPosition + 10000;

			logger.info('Creating task with position', {
				listId,
				currentTasksCount: activeTasks.length,
				maxPosition,
				newPosition
			});

			// Get current user ID
			const currentUser = get(user);
			if (!currentUser || !currentUser.id) {
				throw new Error('Użytkownik nie jest zalogowany');
			}

			// Encrypt recurrence rule if provided
			let recurrenceRuleEncrypted: string | undefined;
			if (data.recurrence_rule) {
				recurrenceRuleEncrypted = await cryptoManager.encryptText(data.recurrence_rule);
			}

			// Bundle sensitive metadata and encrypt
			const sensitiveMetadata: TaskSensitiveMetadata = {
				due_date: data.due_date ?? null,
				has_time: data.has_time || false,
				is_completed: false,
				is_starred: data.is_starred || false,
				is_recurring: data.is_recurring || false,
				completed_at: null,
				reminder_date: data.reminder_date ?? null,
				next_occurrence_date: data.next_occurrence_date ?? null,
				recurrence_base_date: data.recurrence_base_date ?? null,
				completed_occurrences_count: 0,
				notification_sent: false
			};
			const metadataEncrypted = await cryptoManager.encryptObject(sensitiveMetadata);

			// Prepare encrypted task with local shadow indexes
			const now = new Date().toISOString();
			const encryptedTask: TaskEncryptedBooleans = {
				id: crypto.randomUUID(),
				user_id: currentUser.id,
				task_list_id: listId,
				title_encrypted: titleEncrypted,
				description_encrypted: descriptionEncrypted,
				metadata_encrypted: metadataEncrypted,
				recurrence_rule_encrypted: recurrenceRuleEncrypted,
				parent_task_id: data.parent_task_id,
				is_template: data.is_template || false,
				position: newPosition,
				// Shadow indexes (local-only, extracted from metadata for IndexedDB queries)
				is_completed: false,
				is_starred: data.is_starred || false,
				is_recurring: data.is_recurring || false,
				due_date: data.due_date,
				// Syncable fields
				created_at: now,
				updated_at: now,
				deleted_at: null,
				sync_version: 0,
				sync_status: 'pending' as const,
				last_sync_at: null
			};

			// Save to IndexedDB
			await taskStore.save(encryptedTask);

			// Update index
			taskIndex.update(encryptedTask.id, {
				title: data.title!,
				listId: listId,
				createdAt: now,
				updatedAt: now,
				isCompleted: false,
				isStarred: data.is_starred || false,
				isDeleted: false,
				deletedAt: null,
				dueDate: data.due_date ?? null,
				hasTime: data.has_time || false,
				isRecurring: data.is_recurring || false,
				isTemplate: data.is_template || false,
				completedAt: null,
				completedOccurrencesCount: 0,
				position: newPosition,
				parentTaskId: data.parent_task_id ?? null
			});

			// Register offline operation
			const taskForSync = this.convertToApiFormat(encryptedTask);
			await addOperation({
				type: 'create',
				entityType: 'task',
				entityId: encryptedTask.id,
				data: taskForSync
			});
			syncService.scheduleSyncSoon();

			// Update counts
			await taskCounts.refresh();
			await tick();

			logger.info('Zadanie utworzone pomyślnie', { id: encryptedTask.id, listId });

			return encryptedTask.id;
		} catch (error: unknown) {
			logger.error('Błąd tworzenia zadania:', error);
			throw error;
		}
	}

	/**
	 * Updates an existing task
	 */
	async updateTask(id: string, updates: Partial<Omit<TaskDecrypted, 'id' | 'created_at'>>) {
		try {
			// Log update request
			logger.info('updateTask called', { id, updates });

			// Get the current encrypted task
			const encryptedTask = await taskStore.get(id);
			if (!encryptedTask) {
				throw new Error('Zadanie nie zostało znalezione');
			}

			// Check if we're adding recurrence to a non-template task
			const isAddingRecurrence =
				!encryptedTask.is_template &&
				!encryptedTask.is_recurring &&
				updates.recurrence_rule &&
				updates.is_recurring;

			if (isAddingRecurrence) {
				logger.info('Converting regular task to recurring template', { id });
				return await this.convertToRecurringTemplate(id, encryptedTask, updates);
			}

			// Log current task state
			logger.info('Current task state', {
				id: encryptedTask.id,
				position: encryptedTask.position,
				title_encrypted: encryptedTask.title_encrypted.substring(0, 20) + '...'
			});

			// Prepare updated encrypted task
			const updatedTask: TaskEncryptedBooleans = { ...encryptedTask };

			// Update encrypted title if provided
			if (updates.title !== undefined) {
				updatedTask.title_encrypted = await cryptoManager.encryptText(updates.title);
			}

			// Update encrypted description if provided
			if (updates.description !== undefined) {
				updatedTask.description_encrypted = await cryptoManager.encryptText(updates.description);
			}

			// Update encrypted recurrence rule if provided
			if ('recurrence_rule' in updates) {
				updatedTask.recurrence_rule_encrypted = updates.recurrence_rule
					? await cryptoManager.encryptText(updates.recurrence_rule)
					: undefined;
			}

			// Decrypt existing metadata, merge sensitive field updates, re-encrypt
			const currentMetadata = await cryptoManager.decryptObject<TaskSensitiveMetadata>(
				encryptedTask.metadata_encrypted
			);
			const updatedMetadata: TaskSensitiveMetadata = { ...currentMetadata };

			if ('due_date' in updates) {
				updatedMetadata.due_date = updates.due_date ?? null;
			}
			if (updates.has_time !== undefined) updatedMetadata.has_time = updates.has_time;
			if (updates.is_completed !== undefined) {
				updatedMetadata.is_completed = updates.is_completed;
				updatedMetadata.completed_at = updates.is_completed ? new Date().toISOString() : null;

				// Handle recurring task instance completion
				if (updates.is_completed && encryptedTask.parent_task_id) {
					recurrenceService.handleInstanceCompletion(id).catch((error) => {
						logger.error('Failed to handle instance completion', { id, error });
					});
				}
			}
			if (updates.is_starred !== undefined) updatedMetadata.is_starred = updates.is_starred;
			if (updates.is_recurring !== undefined) updatedMetadata.is_recurring = updates.is_recurring;
			if (updates.recurrence_base_date !== undefined)
				updatedMetadata.recurrence_base_date = updates.recurrence_base_date ?? null;
			if (updates.next_occurrence_date !== undefined)
				updatedMetadata.next_occurrence_date = updates.next_occurrence_date ?? null;
			if (updates.completed_occurrences_count !== undefined)
				updatedMetadata.completed_occurrences_count = updates.completed_occurrences_count;
			if (updates.reminder_date !== undefined)
				updatedMetadata.reminder_date = updates.reminder_date ?? null;
			if (updates.notification_sent !== undefined)
				updatedMetadata.notification_sent = updates.notification_sent;

			updatedTask.metadata_encrypted = await cryptoManager.encryptObject(updatedMetadata);

			// Update shadow indexes (local-only, for IndexedDB queries)
			updatedTask.is_completed = updatedMetadata.is_completed;
			updatedTask.is_starred = updatedMetadata.is_starred;
			updatedTask.is_recurring = updatedMetadata.is_recurring;
			updatedTask.due_date = updatedMetadata.due_date ?? undefined;

			// Update non-sensitive fields
			if (updates.task_list_id !== undefined) updatedTask.task_list_id = updates.task_list_id;
			if (updates.parent_task_id !== undefined) updatedTask.parent_task_id = updates.parent_task_id;
			if (updates.is_template !== undefined) updatedTask.is_template = updates.is_template;
			if (updates.position !== undefined) updatedTask.position = updates.position;
			if ('deleted_at' in updates) {
				updatedTask.deleted_at = updates.deleted_at === undefined ? null : updates.deleted_at;
			}

			// Update timestamps and sync status
			updatedTask.updated_at = new Date().toISOString();
			updatedTask.sync_status = 'pending' as const;

			// Log what will be saved
			logger.info('Saving updated task', {
				id: updatedTask.id,
				newPosition: updatedTask.position,
				updated_at: updatedTask.updated_at
			});

			// Save to IndexedDB
			await taskStore.save(updatedTask);

			// Update index — always update to keep all fields in sync
			{
				const currentTitle = updates.title ?? taskIndex.getTitle(id) ?? '';
				taskIndex.update(id, {
					title: currentTitle,
					listId: updatedTask.task_list_id,
					createdAt: updatedTask.created_at,
					updatedAt: updatedTask.updated_at,
					isCompleted: updatedMetadata.is_completed ?? false,
					isStarred: updatedMetadata.is_starred ?? false,
					isDeleted: !!updatedTask.deleted_at,
					deletedAt: updatedTask.deleted_at ?? null,
					dueDate: updatedMetadata.due_date ?? null,
					hasTime: updatedMetadata.has_time ?? false,
					isRecurring: updatedMetadata.is_recurring ?? false,
					isTemplate: updatedTask.is_template ?? false,
					completedAt: updatedMetadata.completed_at ?? null,
					completedOccurrencesCount: updatedMetadata.completed_occurrences_count ?? 0,
					position: updatedTask.position,
					parentTaskId: updatedTask.parent_task_id ?? null
				});
			}
			const verifyTask = await taskStore.get(id);
			logger.info('Task after save', {
				id: verifyTask?.id,
				position: verifyTask?.position,
				updated_at: verifyTask?.updated_at
			});

			// Register offline operation
			const taskForSync = this.convertToApiFormat(updatedTask);
			await addOperation({
				type: 'update',
				entityType: 'task',
				entityId: updatedTask.id,
				data: taskForSync
			});
			syncService.scheduleSyncSoon();

			// Update counts
			await taskCounts.refresh();
			await tick();

			logger.info('Zadanie zaktualizowane pomyślnie', { id, newPosition: updatedTask.position });
		} catch (error: unknown) {
			logger.error('Błąd aktualizacji zadania:', error);
			throw error;
		}
	}

	/**
	 * Soft deletes a task
	 */
	async deleteTask(id: string) {
		try {
			// Get the current encrypted task
			const encryptedTask = await taskStore.get(id);
			if (!encryptedTask) {
				throw new Error('Zadanie nie zostało znalezione');
			}

			// Soft delete by setting deleted_at
			const updatedTask: TaskEncryptedBooleans = {
				...encryptedTask,
				deleted_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				sync_status: 'pending' as const
			};

			// Save to IndexedDB
			await taskStore.save(updatedTask);

			// Mark as deleted in index
			const existing = taskIndex.get(id);
			taskIndex.update(id, {
				title: existing?.title ?? '',
				listId: updatedTask.task_list_id,
				createdAt: existing?.createdAt ?? updatedTask.created_at,
				updatedAt: updatedTask.updated_at,
				isCompleted: updatedTask.is_completed ?? false,
				isStarred: updatedTask.is_starred ?? false,
				isDeleted: true,
				deletedAt: updatedTask.deleted_at ?? null,
				dueDate: existing?.dueDate ?? null,
				hasTime: existing?.hasTime ?? false,
				isRecurring: existing?.isRecurring ?? false,
				isTemplate: existing?.isTemplate ?? false,
				completedAt: existing?.completedAt ?? null,
				completedOccurrencesCount: existing?.completedOccurrencesCount ?? 0,
				position: existing?.position ?? updatedTask.position,
				parentTaskId: existing?.parentTaskId ?? null
			});

			// Register offline operation as UPDATE (not delete) since it's a soft delete
			const taskForSync = this.convertToApiFormat(updatedTask);
			await addOperation({
				type: 'update', // Changed from 'delete' to 'update'
				entityType: 'task',
				entityId: updatedTask.id,
				data: taskForSync
			});
			syncService.scheduleSyncSoon();

			// Update counts
			await taskCounts.refresh();
			await tick();

			logger.info('Zadanie usunięte pomyślnie (soft delete)', { id });
		} catch (error: unknown) {
			logger.error('Błąd usuwania zadania:', error);
			throw error;
		}
	}

	/**
	 * Delete recurring task instance with option to delete future instances
	 */
	async deleteRecurringInstance(id: string, option: 'this_only' | 'future') {
		try {
			// Get the current instance
			const instance = await taskStore.get(id);
			if (!instance || !instance.parent_task_id) {
				throw new Error('Zadanie nie jest instancją cykliczną');
			}

			if (option === 'this_only') {
				// Just delete this instance
				await this.deleteTask(id);
			} else if (option === 'future') {
				// Delete this and all future instances
				await this.deleteThisAndFutureInstances(instance);
			}
		} catch (error: unknown) {
			logger.error('Błąd usuwania instancji cyklicznej:', error);
			throw error;
		}
	}

	/**
	 * Delete current and all future instances of a recurring task
	 */
	private async deleteThisAndFutureInstances(instance: TaskEncryptedBooleans) {
		try {
			if (!instance.parent_task_id || !instance.due_date) {
				throw new Error('Invalid recurring instance');
			}

			// Get all instances of the same template
			const allInstances = await taskQueries.instancesOfTemplate(instance.parent_task_id);

			// Filter instances that are on or after the current instance's date
			const instanceDate = new Date(instance.due_date);
			const instancesToDelete = allInstances.filter((task) => {
				if (!task.due_date || task.deleted_at) return false;
				return new Date(task.due_date) >= instanceDate;
			});

			logger.info('Deleting future recurring instances', {
				instanceId: instance.id,
				templateId: instance.parent_task_id,
				instanceDate: instance.due_date,
				instancesToDeleteCount: instancesToDelete.length
			});

			// Delete all matching instances
			for (const taskToDelete of instancesToDelete) {
				await this.deleteTask(taskToDelete.id);
			}
		} catch (error: unknown) {
			logger.error('Failed to delete future instances:', error);
			throw error;
		}
	}

	/**
	 * Soft deletes a task with ability to undo
	 * @returns Undo function that restores the task
	 */
	async deleteTaskWithUndo(id: string): Promise<() => Promise<void>> {
		try {
			// Get the current encrypted task before deletion
			const encryptedTask = await taskStore.get(id);
			if (!encryptedTask) {
				throw new Error('Zadanie nie zostało znalezione');
			}

			// Cache the task for undo
			this.deletedTasksCache.set(id, { ...encryptedTask });

			// Delete the task
			await this.deleteTask(id);

			// Return undo function
			return async () => {
				const cachedTask = this.deletedTasksCache.get(id);
				if (!cachedTask) {
					throw new Error('Nie można przywrócić zadania - brak danych w cache');
				}

				// Restore the task by removing deleted_at
				const restoredTask: TaskEncryptedBooleans = {
					...cachedTask,
					deleted_at: null,
					updated_at: new Date().toISOString(),
					sync_status: 'pending' as const
				};

				// Save to IndexedDB
				await taskStore.save(restoredTask);

				// Restore in index
				taskIndex.patch(id, {
					isDeleted: false,
					deletedAt: null,
					updatedAt: restoredTask.updated_at
				});

				// Register offline operation
				const taskForSync = this.convertToApiFormat(restoredTask);
				await addOperation({
					type: 'update',
					entityType: 'task',
					entityId: restoredTask.id,
					data: taskForSync
				});
				syncService.scheduleSyncSoon();

				// Update counts
				await taskCounts.refresh();
				await tick();

				// Remove from cache after successful restore
				this.deletedTasksCache.delete(id);

				logger.info('Zadanie przywrócone pomyślnie', { id });
			};
		} catch (error: unknown) {
			logger.error('Błąd usuwania zadania z możliwością cofnięcia:', error);
			throw error;
		}
	}

	/**
	 * Moves multiple completed tasks to trash (soft delete)
	 * Used by "clear completed" actions in task lists
	 */
	async moveCompletedToTrash(taskIds: string[]): Promise<number> {
		let deletedCount = 0;
		try {
			for (const id of taskIds) {
				try {
					await this.deleteTask(id);
					deletedCount++;
				} catch {
					logger.warn('Failed to soft-delete task, skipping:', { id });
				}
			}
			logger.info('Moved completed tasks to trash', {
				requested: taskIds.length,
				deleted: deletedCount
			});
			return deletedCount;
		} catch (error: unknown) {
			logger.error('Error moving completed tasks to trash:', error);
			throw error;
		}
	}

	/**
	 * Toggles task completion status
	 */
	async toggleCompleted(id: string) {
		try {
			// Get current task
			const task = await taskStore.get(id);
			if (!task) {
				throw new Error('Zadanie nie zostało znalezione');
			}

			// Simply toggle the boolean value
			const isCompleted = !task.is_completed;

			await this.updateTask(id, { is_completed: isCompleted });
		} catch (error: unknown) {
			logger.error('Błąd przełączania statusu wykonania:', error);
			throw error;
		}
	}

	/**
	 * Toggles task starred status
	 */
	async toggleStarred(id: string) {
		try {
			// Get current task
			const task = await taskStore.get(id);
			if (!task) {
				throw new Error('Zadanie nie zostało znalezione');
			}

			// Simply toggle the boolean value
			const isStarred = !task.is_starred;

			await this.updateTask(id, { is_starred: isStarred });
		} catch (error: unknown) {
			logger.error('Błąd przełączania gwiazdki:', error);
			throw error;
		}
	}

	/**
	 * Restore a task from trash
	 */
	async restoreTask(id: string) {
		try {
			// Get the task
			const task = await taskStore.get(id);
			if (!task) {
				throw new Error('Task not found');
			}

			if (!task.deleted_at) {
				throw new Error('Task is not in trash');
			}

			// Restore by clearing deleted_at
			await this.updateTask(id, { deleted_at: undefined });

			logger.info('Task restored successfully', { id });
		} catch (error: unknown) {
			logger.error('Failed to restore task:', error);
			throw error;
		}
	}

	/**
	 * Permanently delete a task from the database
	 */
	async permanentlyDeleteTask(id: string) {
		try {
			// Get the task to ensure it exists and is in trash
			const task = await taskStore.get(id);
			if (!task) {
				throw new Error('Task not found');
			}

			if (!task.deleted_at) {
				throw new Error('Task is not in trash - use soft delete first');
			}

			// Check if this is a recurring task instance
			const parentTemplateId = task.parent_task_id;

			// Permanently delete from IndexedDB
			await taskStore.delete(id);

			// Remove from index
			taskIndex.remove(id);

			// Register offline operation for permanent delete
			// Send minimal data to distinguish from soft delete
			await addOperation({
				type: 'delete',
				entityType: 'task',
				entityId: id,
				data: { id, permanent: true } // Add 'permanent' flag
			});
			syncService.scheduleSyncSoon();

			// Update counts
			await taskCounts.refresh();
			await tick();

			logger.info('Task permanently deleted', { id });

			// If this was a recurring task instance, check if template should be cleaned up
			if (parentTemplateId) {
				logger.info('Task was a recurring instance - checking template for cleanup', {
					instanceId: id,
					templateId: parentTemplateId
				});
				// Import dynamically to avoid circular dependency
				const { trashManagementService } = await import('./trash-management.service');
				await trashManagementService.checkAndCleanupOrphanedTemplate(parentTemplateId);
			}
		} catch (error: unknown) {
			logger.error('Failed to permanently delete task:', error);
			throw error;
		}
	}

	/**
	 * Moves multiple tasks to a different list
	 */
	async moveTasksToList(taskIds: string[], targetListId: string) {
		try {
			const affectedListIds = new Set<string>();

			for (const taskId of taskIds) {
				const task = await taskStore.get(taskId);
				if (!task) continue;

				// Track affected lists for count updates
				affectedListIds.add(task.task_list_id);

				// Update task's list
				await this.updateTask(taskId, { task_list_id: targetListId });
			}

			// Add target list to affected lists
			affectedListIds.add(targetListId);

			// Update counts for all affected lists
			await taskCounts.refresh();
			await tick();

			logger.info('Zadania przeniesione pomyślnie', {
				taskCount: taskIds.length,
				targetListId
			});
		} catch (error: unknown) {
			logger.error('Błąd przenoszenia zadań:', error);
			throw error;
		}
	}

	/**
	 * Convert a regular task to a recurring template
	 */
	private async convertToRecurringTemplate(
		id: string,
		encryptedTask: TaskEncryptedBooleans,
		updates: Partial<TaskDecrypted>
	): Promise<void> {
		try {
			// When converting existing task to recurring:
			// 1. The existing task becomes a template (hidden from UI)
			// 2. We create the first single instance (single-instance model)

			// Prepare template task data
			const templateTask: TaskEncryptedBooleans = { ...encryptedTask };

			// Update to be a template
			templateTask.is_template = true;
			templateTask.is_recurring = true;

			// Update metadata with recurrence_base_date
			const currentMeta = await cryptoManager.decryptObject<TaskSensitiveMetadata>(
				encryptedTask.metadata_encrypted
			);
			currentMeta.is_recurring = true;
			currentMeta.recurrence_base_date = encryptedTask.due_date || new Date().toISOString();
			templateTask.metadata_encrypted = await cryptoManager.encryptObject(currentMeta);

			// Update recurrence rule
			if (updates.recurrence_rule) {
				templateTask.recurrence_rule_encrypted = await cryptoManager.encryptText(
					updates.recurrence_rule
				);
			}

			// Update timestamps
			templateTask.updated_at = new Date().toISOString();
			templateTask.sync_status = 'pending' as const;

			// Save template
			await taskStore.save(templateTask);

			// Update task index so the template is immediately hidden from UI
			taskIndex.patch(templateTask.id, {
				isTemplate: true,
				isRecurring: true
			});

			// Register offline operation
			const templateForSync = this.convertToApiFormat(templateTask);
			await addOperation({
				type: 'update',
				entityType: 'task',
				entityId: templateTask.id,
				data: templateForSync
			});
			syncService.scheduleSyncSoon();

			logger.info('Task converted to recurring template', {
				id: templateTask.id,
				recurrence_rule: updates.recurrence_rule,
				recurrence_base_date: currentMeta.recurrence_base_date
			});

			// Generate the first single instance
			await recurrenceService.generateNextInstanceForTemplate(templateTask.id);

			// Update counts
			await taskCounts.refresh();
			await tick();
		} catch (error: unknown) {
			logger.error('Failed to convert task to recurring template:', error);
			throw error;
		}
	}

	/**
	 * Create a recurring task with template
	 */
	async createRecurringTask(
		data: Partial<TaskDecrypted>,
		listId: string,
		rrule: string
	): Promise<string> {
		try {
			// Create the template task
			const templateData: Partial<TaskDecrypted> = {
				...data,
				is_template: true,
				is_recurring: true,
				recurrence_rule: rrule,
				recurrence_base_date: data.due_date || new Date().toISOString()
			};

			const templateId = await this.createTask(templateData, listId);

			// Generate the first single instance
			await recurrenceService.generateNextInstanceForTemplate(templateId);

			return templateId;
		} catch (error: unknown) {
			logger.error('Failed to create recurring task', error);
			throw error;
		}
	}

	/**
	 * Converts TaskEncryptedBooleans to TaskEncrypted for API.
	 * Strips local-only shadow indexes (is_completed, is_starred, is_recurring, due_date).
	 */
	private convertToApiFormat(task: TaskEncryptedBooleans): TaskEncrypted {
		return {
			id: task.id,
			user_id: task.user_id,
			task_list_id: task.task_list_id,
			title_encrypted: task.title_encrypted,
			description_encrypted: task.description_encrypted,
			metadata_encrypted: task.metadata_encrypted,
			recurrence_rule_encrypted: task.recurrence_rule_encrypted,
			parent_task_id: task.parent_task_id,
			is_template: (task.is_template ? 1 : 0) as BooleanInt,
			position: task.position,
			created_at: task.created_at,
			updated_at: task.updated_at,
			deleted_at: task.deleted_at,
			sync_version: task.sync_version,
			sync_status: task.sync_status,
			last_sync_at: task.last_sync_at
		};
	}
}

export const taskOperationsService = new TaskOperationsService();
