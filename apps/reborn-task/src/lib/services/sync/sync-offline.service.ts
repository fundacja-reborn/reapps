import { SyncBaseService } from './sync-base.service';
import { offlineOperationsStore } from '$lib/stores/offline-operations.store';
import type { StorageOfflineOperation } from '@reborn/types';

/**
 * Service responsible for managing offline operations
 */
export class SyncOfflineService extends SyncBaseService {
	constructor() {
		super('SyncOfflineService');
	}

	/**
	 * Get all offline operations
	 */
	async getAll(): Promise<StorageOfflineOperation[]> {
		return await offlineOperationsStore.getAll();
	}

	/**
	 * Get pending offline operations
	 */
	getPendingOperations(): StorageOfflineOperation[] {
		return offlineOperationsStore.getPendingOperations();
	}

	/**
	 * Update operation status
	 */
	async updateOperationStatus(
		id: string,
		status: 'pending' | 'in_progress' | 'completed' | 'failed',
		error?: string
	): Promise<void> {
		await offlineOperationsStore.updateOperationStatus(id, status, error);
	}

	/**
	 * Remove operation from queue
	 */
	async removeOperation(id: string): Promise<void> {
		await offlineOperationsStore.removeOperation(id);
	}

	/**
	 * Get IDs of entities that have pending or failed operations in the queue
	 */
	getPendingEntityIds(entityType?: string): Set<string> {
		const ops = this.getPendingOperations();
		const ids = new Set<string>();
		for (const op of ops) {
			if (!entityType || op.entityType === entityType) {
				ids.add(op.entityId);
			}
		}
		return ids;
	}

	/**
	 * Remove duplicate operations for the same entity
	 * For update operations: keeps only the latest
	 * For create/delete: keeps the first occurrence
	 */
	deduplicateOperations(operations: StorageOfflineOperation[]): StorageOfflineOperation[] {
		const operationsByEntity = new Map<string, StorageOfflineOperation[]>();

		// Group operations by entity
		for (const operation of operations) {
			const entityKey = `${operation.entityType}-${operation.entityId}`;
			if (!operationsByEntity.has(entityKey)) {
				operationsByEntity.set(entityKey, []);
			}
			operationsByEntity.get(entityKey)!.push(operation);
		}

		const deduplicatedOperations: StorageOfflineOperation[] = [];

		// Process each entity's operations
		for (const [, entityOps] of operationsByEntity) {
			// Sort by timestamp (oldest first)
			entityOps.sort((a, b) => a.timestamp - b.timestamp);

			let hasCreate = false;
			let hasDelete = false;
			let latestUpdate: StorageOfflineOperation | null = null;

			for (const op of entityOps) {
				if (op.type === 'create' && !hasCreate) {
					deduplicatedOperations.push(op);
					hasCreate = true;
				} else if (op.type === 'delete' && !hasDelete) {
					// If we have a delete, we can ignore all previous updates
					latestUpdate = null;
					hasDelete = true;
					// We'll add delete operation at the end
				} else if (op.type === 'update' && !hasDelete) {
					// Keep only the latest update
					latestUpdate = op;
				}
			}

			// Add the latest update if exists
			if (latestUpdate) {
				deduplicatedOperations.push(latestUpdate);
			}

			// Add delete operation last if exists
			if (hasDelete) {
				const deleteOp = entityOps.find((op) => op.type === 'delete');
				if (deleteOp) {
					deduplicatedOperations.push(deleteOp);
				}
			}
		}

		// Sort final operations by timestamp to maintain chronological order
		deduplicatedOperations.sort((a, b) => a.timestamp - b.timestamp);

		return deduplicatedOperations;
	}

	/**
	 * Optimize operations by cancelling out opposite operations
	 * For example: CREATE + DELETE for the same entity cancel each other out
	 * Returns both optimized operations and IDs of cancelled operations
	 */
	optimizeOperations(operations: StorageOfflineOperation[]): {
		optimized: StorageOfflineOperation[];
		cancelledIds: string[];
	} {
		const optimized: StorageOfflineOperation[] = [];
		const cancelledOperations = new Set<string>();
		const operationsByEntity = new Map<string, StorageOfflineOperation[]>();

		// Group operations by entity
		for (const operation of operations) {
			const entityKey = `${operation.entityType}-${operation.entityId}`;
			if (!operationsByEntity.has(entityKey)) {
				operationsByEntity.set(entityKey, []);
			}
			operationsByEntity.get(entityKey)!.push(operation);
		}

		// Analyze each entity's operations
		for (const [entityKey, entityOps] of operationsByEntity) {
			// Sort by timestamp to maintain chronological order
			entityOps.sort((a, b) => a.timestamp - b.timestamp);

			// Check for CREATE + DELETE pattern
			const createOp = entityOps.find((op) => op.type === 'create');
			const deleteOp = entityOps.find((op) => op.type === 'delete');

			if (createOp && deleteOp) {
				// Entity was created and deleted offline - cancel both operations
				this.logger.info(`Cancelling CREATE+DELETE operations for ${entityKey}`);
				cancelledOperations.add(createOp.id);
				cancelledOperations.add(deleteOp.id);

				// Also cancel any UPDATE operations for this entity
				for (const op of entityOps) {
					if (op.type === 'update') {
						this.logger.debug(`Cancelling UPDATE operation for deleted entity ${entityKey}`);
						cancelledOperations.add(op.id);
					}
				}
			} else {
				// No cancellation - keep all operations for this entity
				for (const op of entityOps) {
					if (!cancelledOperations.has(op.id)) {
						optimized.push(op);
					}
				}
			}
		}

		// Check for recurring task patterns
		const tasksToRemove = new Set<string>();
		for (const operation of optimized) {
			if (operation.entityType === 'task' && operation.type === 'delete') {
				const taskData = operation.data as Record<string, unknown> | null;

				// If this is a template deletion, check if all its instances are also being deleted
				if (taskData?.is_template === 1) {
					const templateId = operation.entityId;

					// Find all instance deletions for this template
					const instanceDeletions = optimized.filter(
						(op) =>
							op.entityType === 'task' &&
							op.type === 'delete' &&
							(op.data as Record<string, unknown> | null)?.parent_task_id === templateId
					);

					// If we're deleting a template and all its instances were created offline
					// and are now being deleted, we might have already cancelled them
					this.logger.debug(
						`Template ${templateId} deletion found with ${instanceDeletions.length} instance deletions`
					);
				}
			}
		}

		const cancelledCount = cancelledOperations.size;
		if (cancelledCount > 0) {
			this.logger.info(`Optimized away ${cancelledCount} operations`);
		}

		return {
			optimized: optimized.filter((op) => !tasksToRemove.has(op.id)),
			cancelledIds: Array.from(cancelledOperations)
		};
	}

	/**
	 * Sort operations to ensure proper order: CREATE -> UPDATE -> DELETE
	 * Also handles special case for recurring tasks (instances before templates)
	 */
	sortOperations(operations: StorageOfflineOperation[]): StorageOfflineOperation[] {
		return [...operations].sort((a, b) => {
			// Define operation type priority
			const typePriority: Record<string, number> = {
				create: 1,
				update: 2,
				delete: 3
			};

			// Special handling for DELETE operations on tasks
			if (
				a.type === 'delete' &&
				b.type === 'delete' &&
				a.entityType === 'task' &&
				b.entityType === 'task'
			) {
				// Check if we have parent_task_id in the data to determine if it's an instance
				const aData = a.data as Record<string, unknown> | null;
				const bData = b.data as Record<string, unknown> | null;

				const aIsInstance = aData?.parent_task_id != null;
				const bIsInstance = bData?.parent_task_id != null;

				// If one is instance and other is template, instance goes first
				if (aIsInstance && !bIsInstance) return -1;
				if (!aIsInstance && bIsInstance) return 1;

				// If both are instances of the same template, maintain timestamp order
				if (aIsInstance && bIsInstance && aData.parent_task_id === bData.parent_task_id) {
					return a.timestamp - b.timestamp;
				}
			}

			// First sort by entity and entityId to group related operations
			if (a.entityType === b.entityType && a.entityId === b.entityId) {
				// For the same entity, sort by operation type priority
				const priorityDiff = (typePriority[a.type] || 999) - (typePriority[b.type] || 999);
				if (priorityDiff !== 0) return priorityDiff;
				// If same type, sort by timestamp
				return a.timestamp - b.timestamp;
			}
			// Different entities - sort by timestamp
			return a.timestamp - b.timestamp;
		});
	}

	/**
	 * Clean up duplicate operations from the queue
	 */
	async cleanupDuplicateOperations(): Promise<void> {
		try {
			const allOperations = await offlineOperationsStore.getAll();
			const operationsByEntity = new Map<string, StorageOfflineOperation[]>();

			// Group operations by entity
			for (const op of allOperations) {
				const key = `${op.entityType}-${op.entityId}`;
				if (!operationsByEntity.has(key)) {
					operationsByEntity.set(key, []);
				}
				operationsByEntity.get(key)!.push(op);
			}

			// Remove duplicates for each entity
			for (const [key, ops] of operationsByEntity) {
				if (ops.length <= 1) continue;

				// Sort by timestamp (newest first)
				ops.sort((a, b) => b.timestamp - a.timestamp);

				// Keep only the latest operation of each type
				const toKeep = new Set<string>();
				const typeSeen = new Set<string>();

				for (const op of ops) {
					if (!typeSeen.has(op.type)) {
						toKeep.add(op.id);
						typeSeen.add(op.type);
					}
				}

				// Remove duplicates
				for (const op of ops) {
					if (!toKeep.has(op.id)) {
						this.logger.debug(`Removing duplicate operation: ${op.id} (${op.type} for ${key})`);
						await offlineOperationsStore.removeOperation(op.id);
					}
				}
			}
		} catch (error: unknown) {
			this.logger.error('Failed to cleanup duplicate operations:', error);
		}
	}
}
