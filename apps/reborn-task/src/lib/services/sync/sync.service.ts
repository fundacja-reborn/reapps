import { get } from 'svelte/store';
import { createLogger } from '@reborn/utils';
import { taskCounts } from '$lib/stores/task-counts.store';
import { taskStore, listStore, subtaskStore } from '@reborn/storage';
import { localOnly } from '$lib/stores/local-mode.store';
import { taskTitleIndex } from '$lib/services/task-title-index.svelte';
import { SyncListsService } from './sync-lists.service';
import { SyncTasksService } from './sync-tasks.service';
import { SyncSubtasksService } from './sync-subtasks.service';
import { SyncOfflineService } from './sync-offline.service';
import { PermanentOperationError } from './operation-error';
import { connectivityStore, checkOnline } from '$lib/stores/connectivity.store';
import { isNetworkError } from '$lib/stores/network.store';
import { refreshSyncErrors } from '$lib/stores/sync-errors.store';
import { notifyTaskSyncErrors } from '$lib/services/sync-error-notify';
import type { StorageOfflineOperation, TaskEncryptedBooleans, SyncErrorCode } from '@reborn/types';

const logger = createLogger('SyncService');

/** Hint the connectivity probe on network-smelling errors so the indicator
 * catches up with reality (navigator.onLine cannot, because a VPN tunnel
 * satisfies the browser's "interface present" heuristic). */
function reportIfNetwork(err: unknown): void {
	if (isNetworkError(err)) connectivityStore?.markFailure();
}

export interface SyncProgress {
	isInProgress: boolean;
	stage: 'idle' | 'lists' | 'tasks' | 'complete';
	progress: number; // 0-100
	message: string;
}

/**
 * Main sync service that orchestrates all sync operations
 */
class SyncService {
	private isSyncing = false;
	/** Stored promise so concurrent callers wait for the same sync to finish */
	private _initialSyncPromise: Promise<void> | null = null;
	private progressCallbacks: ((progress: SyncProgress) => void)[] = [];
	private conflictCallbacks: ((updatedCount: number) => void)[] = [];
	private syncSoonTimer: ReturnType<typeof setTimeout> | null = null;
	private static readonly SYNC_SOON_DELAY_MS = 1500;

	// Sub-services
	private listsService: SyncListsService;
	private tasksService: SyncTasksService;
	private subtasksService: SyncSubtasksService;
	private offlineService: SyncOfflineService;

	constructor() {
		// Initialize sub-services
		this.listsService = new SyncListsService();
		this.tasksService = new SyncTasksService();
		this.subtasksService = new SyncSubtasksService();
		this.offlineService = new SyncOfflineService();

		logger.debug('Sync service initialized');
	}

	/**
	 * Clean up failed delete operations for non-existent entities
	 * This handles cases where entities were deleted through multiple paths
	 */
	async cleanupFailedDeleteOperations(): Promise<void> {
		try {
			const allOperations = await this.offlineService.getAll();

			// Find failed delete operations
			const failedDeletes = allOperations.filter(
				(op) =>
					op.type === 'delete' &&
					op.status === 'failed' &&
					op.error &&
					op.error.toLowerCase().includes('not found')
			);

			logger.info(`Found ${failedDeletes.length} failed delete operations to clean up`);

			for (const op of failedDeletes) {
				// If it's a permanent delete of an entity that doesn't exist, it's effectively successful
				if (
					op.data &&
					typeof op.data === 'object' &&
					'permanent' in op.data &&
					op.data.permanent === true
				) {
					logger.info(
						`Removing failed permanent delete operation - ${op.entityType} already gone`,
						{
							opId: op.id,
							entityId: op.entityId
						}
					);
					await this.offlineService.removeOperation(op.id);
				}
			}
		} catch (error: unknown) {
			logger.error('Failed to cleanup failed operations:', error);
		}
	}

	/**
	 * Legacy method kept for backward compatibility
	 */
	setAuthToken(_token: string): void {
		// Kept for backward compatibility — auth token is handled by AuthInterceptor via localStorage
		void _token;
		logger.debug('Auth token update requested (handled by AuthInterceptor)');
	}

	/**
	 * Subscribe to sync progress updates
	 */
	onProgress(callback: (progress: SyncProgress) => void): () => void {
		this.progressCallbacks.push(callback);
		return () => {
			this.progressCallbacks = this.progressCallbacks.filter((cb) => cb !== callback);
		};
	}

	private updateProgress(progress: SyncProgress) {
		this.progressCallbacks.forEach((cb) => cb(progress));
	}

	/**
	 * Subscribe to conflict notifications (server data was newer than local)
	 */
	onConflict(callback: (updatedCount: number) => void): () => void {
		this.conflictCallbacks.push(callback);
		return () => {
			this.conflictCallbacks = this.conflictCallbacks.filter((cb) => cb !== callback);
		};
	}

	private notifyConflict(updatedCount: number) {
		if (updatedCount > 0) {
			this.conflictCallbacks.forEach((cb) => cb(updatedCount));
		}
	}

	/**
	 * Perform initial sync after login
	 * This syncs all data from server to local IndexedDB.
	 * Concurrent callers share the same in-flight promise so that
	 * post-sync logic (ensureDefaultList) only runs after a real sync.
	 */
	async initialSync(): Promise<void> {
		// Local-only / no-account mode: there is no server session, so every sync
		// is a no-op. Without this gate the hasE2E effect in +layout would push to
		// the server with no token, 401, and mark ops failed (which then never retry).
		if (get(localOnly)) return;
		if (this._initialSyncPromise) {
			logger.debug('Sync already in progress, waiting for existing sync');
			return this._initialSyncPromise;
		}

		this._initialSyncPromise = this._doInitialSync().finally(() => {
			this._initialSyncPromise = null;
		});

		return this._initialSyncPromise;
	}

	private async _doInitialSync(): Promise<void> {

		this.isSyncing = true;
		logger.info('Starting initial sync');

		try {
			// First clean up any failed delete operations
			await this.cleanupFailedDeleteOperations();

			// First, sync any pending offline operations
			this.updateProgress({
				isInProgress: true,
				stage: 'lists',
				progress: 0,
				message: 'Syncing offline operations...'
			});

			// Process offline operations first to ensure server has latest data
			const offlineOpsResult = await this.syncOfflineOperations();

			// Track if we just synced soft delete operations
			let syncedSoftDeletes = 0;
			let syncedRecurringSoftDeletes = 0;

			// Check recently completed operations from this sync
			if (offlineOpsResult && offlineOpsResult.processedOps) {
				for (const op of offlineOpsResult.processedOps) {
					if (
						op.type === 'update' &&
						op.entityType === 'task' &&
						op.data &&
						typeof op.data === 'object' &&
						op.data !== null &&
						'deleted_at' in op.data &&
						op.data.deleted_at !== null
					) {
						syncedSoftDeletes++;

						if ('is_recurring' in op.data && op.data.is_recurring === 1) {
							syncedRecurringSoftDeletes++;
						}
					}
				}
			}

			// Give the server a moment to process the operations
			// This prevents UI flicker when soft-deleted tasks haven't been processed yet
			if (syncedSoftDeletes > 0) {
				logger.debug(
					`Waiting for server to process ${syncedSoftDeletes} soft delete operations...`
				);

				// Longer wait for multiple deletes or recurring tasks
				let waitTime = 500;
				if (syncedRecurringSoftDeletes > 0) {
					waitTime = 1500; // Extra time for recurring tasks
				} else if (syncedSoftDeletes > 5) {
					waitTime = 1000; // Extra time for multiple deletes
				}

				await new Promise((resolve) => setTimeout(resolve, waitTime));
			}

			this.updateProgress({
				isInProgress: true,
				stage: 'lists',
				progress: 25,
				message: 'Syncing task lists...'
			});

			// Sync task lists with retry
			const listUpdates = await this.listsService.retryWithBackoff(() =>
				this.listsService.syncLists()
			);

			this.updateProgress({
				isInProgress: true,
				stage: 'tasks',
				progress: 50,
				message: 'Syncing tasks...'
			});

			// Then sync tasks with retry
			const taskUpdates = await this.tasksService.retryWithBackoff(() =>
				this.tasksService.syncTasks()
			);

			this.updateProgress({
				isInProgress: true,
				stage: 'tasks',
				progress: 75,
				message: 'Syncing subtasks...'
			});

			// Sync subtasks with retry
			await this.subtasksService.retryWithBackoff(() => this.subtasksService.syncSubtasks());

			// Refresh task counts after sync
			taskCounts.refresh();

			// Rebuild title index cache after sync
			await taskTitleIndex.rebuild();

			this.updateProgress({
				isInProgress: false,
				stage: 'complete',
				progress: 100,
				message: 'Sync complete'
			});

			lastSyncedAt.set(new Date().toISOString());

			// Notify about server-side changes (conflict detection)
			const totalServerUpdates = listUpdates + taskUpdates;
			if (totalServerUpdates > 0) {
				logger.info(
					`Detected ${totalServerUpdates} server-side updates (lists: ${listUpdates}, tasks: ${taskUpdates})`
				);
				this.notifyConflict(totalServerUpdates);
			}

			logger.info('Initial sync completed');
		} catch (error: unknown) {
			reportIfNetwork(error);
			logger.error('Initial sync failed:', error);
			this.updateProgress({
				isInProgress: false,
				stage: 'idle',
				progress: 0,
				message: 'Sync failed'
			});
			// Don't re-throw - let the app work offline
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * Schedule a sync to server after a short debounce delay.
	 * Called after every addOperation() so that pending changes are pushed
	 * within ~1.5 s instead of waiting for the 5-minute periodic sync.
	 * Multiple calls within the delay window are collapsed into one sync.
	 */
	scheduleSyncSoon(): void {
		if (get(localOnly)) return;
		if (!checkOnline()) return;

		if (this.syncSoonTimer) {
			clearTimeout(this.syncSoonTimer);
		}

		this.syncSoonTimer = setTimeout(() => {
			this.syncSoonTimer = null;
			this.syncToServer().catch((error) => {
				logger.error('Scheduled sync failed:', error);
			});
		}, SyncService.SYNC_SOON_DELAY_MS);
	}

	/**
	 * Lightweight bidirectional sync for periodic use and tab-return.
	 * Push pending ops → pull lists + tasks + subtasks → refresh stores.
	 * Unlike initialSync(), no progress callbacks and no soft-delete wait.
	 */
	async periodicSync(): Promise<void> {
		if (get(localOnly)) return;
		if (!checkOnline()) {
			logger.debug('Offline - skipping periodic sync');
			return;
		}

		if (this.isSyncing) {
			logger.debug('Sync already in progress, skipping periodic sync');
			return;
		}

		this.isSyncing = true;
		logger.info('Starting periodic bidirectional sync');

		try {
			// Clean up stale operations
			await this.cleanupFailedDeleteOperations();

			// Push pending offline operations
			await this.syncOfflineOperations();

			// Pull from server: lists → tasks → subtasks
			const listUpdates = await this.listsService.retryWithBackoff(() =>
				this.listsService.syncLists()
			);
			const taskUpdates = await this.tasksService.retryWithBackoff(() =>
				this.tasksService.syncTasks()
			);
			await this.subtasksService.retryWithBackoff(() => this.subtasksService.syncSubtasks());

			// Refresh task counts and title index
			taskCounts.refresh();
			await taskTitleIndex.rebuild();

			lastSyncedAt.set(new Date().toISOString());

			// Notify about server-side changes
			const totalServerUpdates = listUpdates + taskUpdates;
			if (totalServerUpdates > 0) {
				logger.info(
					`Periodic sync: ${totalServerUpdates} server-side updates (lists: ${listUpdates}, tasks: ${taskUpdates})`
				);
				this.notifyConflict(totalServerUpdates);
			}

			logger.info('Periodic sync completed');
		} catch (error: unknown) {
			reportIfNetwork(error);
			logger.error('Periodic sync failed:', error);
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * Sync changes from IndexedDB to server
	 * This should be called periodically or after changes
	 */
	async syncToServer(): Promise<{ failedCount: number }> {
		if (get(localOnly)) return { failedCount: 0 };
		if (!checkOnline()) {
			logger.info('Offline - skipping sync to server');
			return { failedCount: 0 };
		}

		if (this.isSyncing) {
			logger.debug('Sync already in progress');
			return { failedCount: 0 };
		}

		this.isSyncing = true;

		try {
			// First clean up any failed delete operations
			await this.cleanupFailedDeleteOperations();

			// Process offline operations queue
			const result = await this.syncOfflineOperations();

			// Log sync result
			if (result.processedOps.length > 0) {
				logger.info(`Synced ${result.processedOps.length} operations to server`);
			}

			return { failedCount: result.failedCount };
		} catch (error: unknown) {
			reportIfNetwork(error);
			logger.error('Failed to sync to server:', error);
			throw error;
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * Process offline operations queue
	 * @returns Information about processed operations
	 */
	async syncOfflineOperations(): Promise<{
		processedOps: StorageOfflineOperation[];
		failedCount: number;
	}> {
		const processedOps: StorageOfflineOperation[] = [];
		let failedCount = 0;
		// Operations the server permanently rejected this run (4xx the client can't
		// fix). Dead-lettered out of the queue + entity marked sync_error; tallied
		// so we raise ONE aggregated toast after the batch instead of per-op spam.
		let newSyncErrors = 0;

		if (get(localOnly)) return { processedOps, failedCount };

		if (!checkOnline()) {
			logger.info('Offline - skipping offline operations sync');
			return { processedOps, failedCount };
		}

		try {
			// Get pending operations
			const pendingOperations = await this.offlineService.getPendingOperations();

			// Optimize operations - cancel out CREATE+DELETE pairs
			const { optimized: optimizedOperations, cancelledIds } =
				this.offlineService.optimizeOperations(pendingOperations);

			// Remove cancelled operations from the store
			for (const cancelledId of cancelledIds) {
				await this.offlineService.removeOperation(cancelledId);
			}

			// Log optimization results
			if (cancelledIds.length > 0) {
				logger.info(`Optimization cancelled ${cancelledIds.length} operations`);
			}

			// Sort operations
			const sortedOperations = this.offlineService.sortOperations(optimizedOperations);

			// Remove duplicate operations for the same entity
			const deduplicatedOperations = this.offlineService.deduplicateOperations(sortedOperations);

			// Remove duplicate operations from the store before processing
			const operationIdsToKeep = new Set(deduplicatedOperations.map((op) => op.id));
			for (const operation of pendingOperations) {
				if (!operationIdsToKeep.has(operation.id)) {
					logger.debug(
						`Removing duplicate operation before processing: ${operation.id} (${operation.type} for ${operation.entityType}-${operation.entityId})`
					);
					await this.offlineService.removeOperation(operation.id);
				}
			}

			logger.info(
				`Processing ${deduplicatedOperations.length} offline operations (${pendingOperations.length - deduplicatedOperations.length} duplicates removed)`
			);

			for (const operation of deduplicatedOperations) {
				try {
					// Update operation status
					await this.offlineService.updateOperationStatus(operation.id, 'in_progress');

					// Process based on entity type
					await this.processOperation(operation);

					// Mark as completed and remove from queue
					await this.offlineService.removeOperation(operation.id);
					logger.debug(`Successfully synced operation ${operation.id}`);

					// Track processed operation
					processedOps.push(operation);
				} catch (error: unknown) {
					reportIfNetwork(error);

					if (error instanceof PermanentOperationError) {
						// Permanent 4xx (e.g. server Zod rejection or a 413 body-limit):
						// this op can never succeed. Dead-letter it - drop it from the
						// queue so it stops shielding the entity from pulls and re-failing
						// forever - and mark the entity sync_error so the user sees which
						// one and why. A later local edit re-queues a push, clearing it.
						logger.warn(
							`Operation ${operation.id} permanently rejected (status ${error.status}, code ${error.code}) - dead-lettering:`,
							error.message
						);
						try {
							await this.markEntitySyncError(
								operation.entityType,
								operation.entityId,
								error.code
							);
						} catch (markErr: unknown) {
							logger.error(
								`Failed to mark ${operation.entityType} ${operation.entityId} sync_error:`,
								markErr
							);
						}
						await this.offlineService.removeOperation(operation.id);
						newSyncErrors++;
						continue;
					}

					logger.error(`Failed to sync operation ${operation.id}:`, error);
					failedCount++;

					// Transient failure: leave the op queued (status 'failed') as before.
					await this.offlineService.updateOperationStatus(
						operation.id,
						'failed',
						error instanceof Error ? error.message : 'Unknown error'
					);

					// Continue with next operation
					continue;
				}
			}

			logger.info('Offline operations sync completed');

			// Refresh task counts after syncing changes
			taskCounts.refresh();
		} catch (error: unknown) {
			reportIfNetwork(error);
			logger.error('Failed to sync offline operations:', error);
		}

		// Surface permanent rejections: one aggregated toast for this run, and
		// rescan IndexedDB so the footer count + per-task badges reflect the new
		// (or cleared) sync_error entities. Runs even on the happy path so a
		// previously-errored task that just synced clears its badge.
		if (newSyncErrors > 0) notifyTaskSyncErrors(newSyncErrors);
		void refreshSyncErrors();

		return { processedOps, failedCount };
	}

	/**
	 * Process a single offline operation
	 */
	private async processOperation(operation: StorageOfflineOperation): Promise<void> {
		switch (operation.entityType) {
			case 'task_list':
				await this.listsService.syncListOperation(operation);
				break;
			case 'task': {
				// For CREATE operations, we need to check and preserve local deleted_at
				if (operation.type === 'create') {
					const localTask = await taskStore.get(operation.entityId);
					const response = await this.tasksService.syncTaskOperation(operation);

					// Preserve local deleted_at state if it exists
					// This prevents "flicker" when syncing soft-deleted tasks
					if (localTask?.deleted_at && response && !response.deleted_at) {
						logger.debug(`Preserving local deleted_at for task ${operation.entityId}`);
						response.deleted_at = localTask.deleted_at;
						await taskStore.save(response as unknown as TaskEncryptedBooleans);
					}
				} else {
					// For other operations (update, delete), just sync normally
					await this.tasksService.syncTaskOperation(operation);
				}
				break;
			}
			case 'sub_task':
				await this.subtasksService.syncSubtaskOperation(operation);
				break;
			default:
				logger.warn(`Unknown entity type: ${operation.entityType}`);
		}
	}

	/**
	 * Mark an entity as permanently rejected after its operation was dead-lettered.
	 * The entity keeps the user's local edit but leaves the push retry loop; the UI
	 * surfaces it (footer count + per-task badge). A later local edit re-marks it
	 * 'pending' and re-queues a push, which clears the error on success.
	 *
	 * Only tasks store a `sync_error_code` (the only entity with a list badge and
	 * the only realistic 413/400 case). Lists/subtasks are marked sync_error so the
	 * footer count is complete; their reason defaults to 'rejected'.
	 */
	private async markEntitySyncError(
		entityType: string,
		entityId: string,
		code: SyncErrorCode
	): Promise<void> {
		if (entityType === 'task') {
			const current = await taskStore.get(entityId);
			if (current) {
				await taskStore.save({
					...current,
					sync_status: 'sync_error',
					sync_error_code: code
				} as unknown as TaskEncryptedBooleans);
			}
		} else if (entityType === 'task_list') {
			const current = await listStore.get(entityId);
			if (current) {
				await listStore.save({ ...current, sync_status: 'sync_error' });
			}
		} else if (entityType === 'sub_task') {
			const current = await subtaskStore.get(entityId);
			if (current) {
				await subtaskStore.save({ ...current, sync_status: 'sync_error' });
			}
		}
	}
}

// Export singleton instance
export const syncService = new SyncService();

// Export sync progress store
import { writable } from 'svelte/store';
export const syncProgress = writable<SyncProgress>({
	isInProgress: false,
	stage: 'idle',
	progress: 0,
	message: ''
});

// Timestamp of the last successful sync. Stays `null` until the very first
// sync of the current session completes — used by `isInitialSync` in
// sync-status.store to distinguish "fresh login, syncing" from "no data".
export const lastSyncedAt = writable<string | null>(null);

// Store for conflict notifications (number of server-updated entities, 0 = no conflict)
export const syncConflict = writable<number>(0);

// Connect sync service to progress store
syncService.onProgress((progress) => {
	syncProgress.set(progress);
});

// Connect sync service to conflict store
syncService.onConflict((updatedCount) => {
	syncConflict.set(updatedCount);
	// Auto-clear after 10 seconds
	setTimeout(() => syncConflict.set(0), 10000);
});
