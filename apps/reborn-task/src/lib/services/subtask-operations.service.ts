import { subtaskStore, subtaskQueries, addOperation } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import type { Subtask, SubtaskStoredLocal, SubtaskEncrypted, SubtaskSensitiveMetadata } from '@reborn/types';
// Using native crypto.randomUUID() instead of uuid package
import { refreshDecryptedSubtasks } from '$lib/stores/decrypted-subtasks.store';
import { syncService } from './sync.service';

const logger = createLogger('SubtaskOperationsService');

export class SubtaskOperationsService {
	/**
	 * Create a new subtask for a task
	 */
	async createSubtask(taskId: string, title: string): Promise<string> {
		try {
			if (!title?.trim()) {
				throw new Error('Subtask title is required');
			}

			if (!cryptoManager.isInitialized()) {
				throw new Error('CryptoManager not initialized');
			}

			// Get current subtasks to determine position
			const existingSubtasks = await subtaskQueries.byTask(taskId);
			const maxPosition = existingSubtasks.reduce((max, st) => Math.max(max, st.position), 0);

			const subtaskId = crypto.randomUUID();
			const now = new Date().toISOString();

			// Create subtask data
			const subtaskData: Subtask = {
				id: subtaskId,
				task_id: taskId,
				title: title.trim(),
				is_completed: false,
				position: maxPosition + 1000,
				created_at: now,
				updated_at: now
			};

			// Encrypt the title and metadata
			const metadataEncrypted = await cryptoManager.encryptObject<SubtaskSensitiveMetadata>({
				is_completed: false
			});

			const encrypted: SubtaskStoredLocal = {
				id: subtaskId,
				task_id: taskId,
				name_encrypted: await cryptoManager.encryptText(subtaskData.title),
				metadata_encrypted: metadataEncrypted,
				is_completed: 0, // Shadow index (local-only)
				position: subtaskData.position,
				user_id: '', // Will be filled by store
				created_at: now,
				updated_at: now,
				deleted_at: null,
				sync_status: 'pending',
				last_sync_at: null,
				sync_version: 0
			};

			// Save to store
			await subtaskStore.save(encrypted);

			// Manually refresh items to ensure reactivity
			await subtaskStore.refreshItems();
			logger.debug('Subtask store refreshed after save');

			// Also refresh decrypted subtasks
			await refreshDecryptedSubtasks();
			logger.debug('Decrypted subtasks refreshed');

			// Queue for sync — strip shadow index
			const forSync = this.stripLocalIndexes(encrypted);
			await addOperation({
				type: 'create',
				entityType: 'sub_task',
				entityId: subtaskId,
				data: forSync
			});
			syncService.scheduleSyncSoon();

			logger.info('Subtask created successfully', { subtaskId, taskId });
			return subtaskId;
		} catch (error: unknown) {
			logger.error('Failed to create subtask:', error);
			throw error;
		}
	}

	/**
	 * Update subtask title
	 */
	async updateSubtaskTitle(subtaskId: string, newTitle: string): Promise<void> {
		try {
			if (!newTitle?.trim()) {
				throw new Error('Subtask title is required');
			}

			const subtask = await subtaskStore.get(subtaskId);
			if (!subtask) {
				throw new Error('Subtask not found');
			}

			// Encrypt new title
			const encryptedTitle = await cryptoManager.encryptText(newTitle.trim());

			// Update subtask
			const updated: SubtaskStoredLocal = {
				...subtask,
				name_encrypted: encryptedTitle,
				updated_at: new Date().toISOString(),
				sync_status: 'pending'
			};

			await subtaskStore.save(updated);

			// Refresh decrypted subtasks
			await refreshDecryptedSubtasks();

			// Queue for sync — strip shadow index
			const forSync = this.stripLocalIndexes(updated);
			await addOperation({
				type: 'update',
				entityType: 'sub_task',
				entityId: subtaskId,
				data: forSync
			});
			syncService.scheduleSyncSoon();

			logger.info('Subtask title updated', { subtaskId });
		} catch (error: unknown) {
			logger.error('Failed to update subtask title:', error);
			throw error;
		}
	}

	/**
	 * Toggle subtask completion status
	 */
	async toggleSubtaskCompletion(subtaskId: string): Promise<void> {
		try {
			const subtask = await subtaskStore.get(subtaskId);
			if (!subtask) {
				throw new Error('Subtask not found');
			}

			// Toggle completion
			const newCompleted = !subtask.is_completed;
			const metadataEncrypted = await cryptoManager.encryptObject<SubtaskSensitiveMetadata>({
				is_completed: !!newCompleted
			});

			const updated: SubtaskStoredLocal = {
				...subtask,
				is_completed: subtask.is_completed ? 0 : 1,
				metadata_encrypted: metadataEncrypted,
				updated_at: new Date().toISOString(),
				sync_status: 'pending'
			};

			await subtaskStore.save(updated);

			// Refresh decrypted subtasks
			await refreshDecryptedSubtasks();

			// Queue for sync — strip shadow index
			const forSync = this.stripLocalIndexes(updated);
			await addOperation({
				type: 'update',
				entityType: 'sub_task',
				entityId: subtaskId,
				data: forSync
			});
			syncService.scheduleSyncSoon();

			logger.info('Subtask completion toggled', { subtaskId, completed: !!updated.is_completed });
		} catch (error: unknown) {
			logger.error('Failed to toggle subtask completion:', error);
			throw error;
		}
	}

	/**
	 * Delete a subtask
	 */
	async deleteSubtask(subtaskId: string): Promise<void> {
		try {
			const subtask = await subtaskStore.get(subtaskId);
			if (!subtask) {
				throw new Error('Subtask not found');
			}

			// Soft delete
			const updated: SubtaskStoredLocal = {
				...subtask,
				deleted_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				sync_status: 'pending'
			};

			await subtaskStore.save(updated);

			// Refresh decrypted subtasks
			await refreshDecryptedSubtasks();

			// Queue for sync — strip shadow index
			const forSync = this.stripLocalIndexes(updated);
			await addOperation({
				type: 'update',
				entityType: 'sub_task',
				entityId: subtaskId,
				data: forSync
			});
			syncService.scheduleSyncSoon();

			logger.info('Subtask deleted', { subtaskId });
		} catch (error: unknown) {
			logger.error('Failed to delete subtask:', error);
			throw error;
		}
	}

	/**
	 * Reorder subtasks (legacy method for compatibility)
	 */
	async reorderSubtasks(taskId: string, subtaskIds: string[]): Promise<void> {
		try {
			// Get all subtasks for validation
			const allSubtasks = await subtaskQueries.byTask(taskId);

			// Validate all subtask IDs belong to this task
			const validIds = new Set(allSubtasks.map((st) => st.id));
			const invalidIds = subtaskIds.filter((id) => !validIds.has(id));

			if (invalidIds.length > 0) {
				throw new Error(`Invalid subtask IDs: ${invalidIds.join(', ')}`);
			}

			// Update positions
			const updates: SubtaskStoredLocal[] = [];
			const now = new Date().toISOString();

			for (let i = 0; i < subtaskIds.length; i++) {
				const subtask = allSubtasks.find((st) => st.id === subtaskIds[i]);
				if (subtask) {
					const newPosition = (i + 1) * 1000; // Simple positioning
					if (subtask.position !== newPosition) {
						updates.push({
							...subtask,
							position: newPosition,
							updated_at: now,
							sync_status: 'pending'
						});
					}
				}
			}

			// Save all updates
			if (updates.length > 0) {
				await subtaskStore.saveMany(updates);

				// Refresh decrypted subtasks
				await refreshDecryptedSubtasks();

				// Queue for sync
				for (const updated of updates) {
					await addOperation({
						type: 'update',
						entityType: 'sub_task',
						entityId: updated.id,
						data: updated
					});
				}

				logger.info('Subtasks reordered', { taskId, count: updates.length });
			}
		} catch (error: unknown) {
			logger.error('Failed to reorder subtasks:', error);
			throw error;
		}
	}

	/**
	 * Handle subtask reorder with fractional indexing for drag & drop
	 * This method only updates the position of the moved subtask
	 */
	async handleSubtaskReorder(sortedSubtasks: Subtask[]): Promise<void> {
		try {
			if (sortedSubtasks.length === 0) return;

			const taskId = sortedSubtasks[0].task_id;
			const originalSubtasks = await subtaskQueries.byTask(taskId);

			// Create a map for original order
			const originalOrder = new Map<string, number>();
			originalSubtasks.forEach((subtask, index) => {
				originalOrder.set(subtask.id, index);
			});

			// Find which subtask moved by finding the one with the largest position change
			let movedSubtask: Subtask | null = null;
			let movedToIndex = -1;
			let maxPositionChange = 0;

			for (let i = 0; i < sortedSubtasks.length; i++) {
				const subtask = sortedSubtasks[i];
				const originalIndex = originalOrder.get(subtask.id);

				if (originalIndex !== undefined && originalIndex !== i) {
					const positionChange = Math.abs(originalIndex - i);
					if (positionChange > maxPositionChange) {
						maxPositionChange = positionChange;
						movedSubtask = subtask;
						movedToIndex = i;
					}
				}
			}

			if (!movedSubtask || movedToIndex === -1) {
				// No change detected
				return;
			}

			// Log for debugging
			logger.debug('Subtask reorder detected', {
				movedSubtaskId: movedSubtask.id,
				movedSubtaskTitle: movedSubtask.title,
				originalIndex: originalOrder.get(movedSubtask.id),
				newIndex: movedToIndex,
				positionChange: maxPositionChange,
				totalSubtasks: sortedSubtasks.length,
				originalPositions: originalSubtasks.map((s) => ({ id: s.id, pos: s.position }))
			});

			// Calculate new position using fractional indexing
			let newPosition: number;

			if (movedToIndex === 0) {
				// Moved to the beginning
				// Get the current first item (in original order)
				const currentFirstSubtask = originalSubtasks[0];
				logger.debug('Moving to beginning', {
					currentFirstId: currentFirstSubtask?.id,
					currentFirstPos: currentFirstSubtask?.position,
					movedId: movedSubtask.id
				});

				if (currentFirstSubtask && currentFirstSubtask.id !== movedSubtask.id) {
					// Place before the current first item
					newPosition = currentFirstSubtask.position / 2;
				} else {
					// If moving the already-first item or only one item exists
					newPosition = 500;
				}
			} else if (movedToIndex === sortedSubtasks.length - 1) {
				// Moved to the end
				// Get the current last item (in original order)
				const currentLastSubtask = originalSubtasks[originalSubtasks.length - 1];
				logger.debug('Moving to end', {
					currentLastId: currentLastSubtask?.id,
					currentLastPos: currentLastSubtask?.position,
					movedId: movedSubtask.id
				});

				if (currentLastSubtask && currentLastSubtask.id !== movedSubtask.id) {
					// Place after the current last item
					newPosition = currentLastSubtask.position + 1000;
				} else {
					// If moving the already-last item or only one item exists
					newPosition = originalSubtasks.length * 1000;
				}
			} else {
				// Moved to the middle - get neighbors from the sorted list
				const prevSubtask = sortedSubtasks[movedToIndex - 1];
				const nextSubtask = sortedSubtasks[movedToIndex + 1];

				const prevOriginal = originalSubtasks.find((s) => s.id === prevSubtask.id);
				const nextOriginal = originalSubtasks.find((s) => s.id === nextSubtask.id);

				logger.debug('Moving to middle', {
					prevId: prevSubtask?.id,
					prevPos: prevOriginal?.position,
					nextId: nextSubtask?.id,
					nextPos: nextOriginal?.position
				});

				if (prevOriginal && nextOriginal) {
					newPosition = (prevOriginal.position + nextOriginal.position) / 2;
				} else {
					// Fallback
					newPosition = (movedToIndex + 1) * 1000;
				}
			}

			// Find the encrypted subtask to update - get fresh data from store
			const encryptedSubtask = await subtaskStore.get(movedSubtask.id);
			if (!encryptedSubtask) {
				throw new Error('Subtask not found');
			}

			// Update only the moved subtask
			const updated: SubtaskStoredLocal = {
				...encryptedSubtask,
				position: newPosition,
				updated_at: new Date().toISOString(),
				sync_status: 'pending'
			};

			await subtaskStore.save(updated);

			// Force immediate refresh of store items
			await subtaskStore.refreshItems();

			// Refresh decrypted subtasks
			await refreshDecryptedSubtasks();

			// Wait for all reactive updates to complete
			const { tick } = await import('svelte');
			await tick();

			// Queue for sync
			await addOperation({
				type: 'update',
				entityType: 'sub_task',
				entityId: updated.id,
				data: updated
			});

			logger.info('Subtask reordered with fractional indexing', {
				subtaskId: movedSubtask.id,
				newPosition,
				previousPosition: encryptedSubtask.position
			});
		} catch (error: unknown) {
			logger.error('Failed to handle subtask reorder:', error);
			throw error;
		}
	}

	/**
	 * Strip local-only shadow index before sending to server.
	 */
	private stripLocalIndexes(subtask: SubtaskStoredLocal): SubtaskEncrypted {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional destructure to strip shadow indexes
		const { is_completed, ...rest } = subtask;
		return rest;
	}

	/**
	 * Delete all subtasks for a task
	 */
	async deleteAllSubtasksForTask(taskId: string): Promise<void> {
		try {
			const subtasks = await subtaskQueries.byTask(taskId);

			for (const subtask of subtasks) {
				await this.deleteSubtask(subtask.id);
			}

			logger.info('All subtasks deleted for task', { taskId, count: subtasks.length });
		} catch (error: unknown) {
			logger.error('Failed to delete all subtasks for task:', error);
			throw error;
		}
	}
}

// Export singleton instance
export const subtaskOperationsService = new SubtaskOperationsService();
