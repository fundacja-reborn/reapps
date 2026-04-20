import { writable, derived, get } from 'svelte/store';
import { tick } from 'svelte';
import { goto } from '$lib/utils/navigation';
import { taskStore, subtaskStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { taskOperationsService } from './task-operations.service';
import { recurrenceService } from './recurrence.service';
import { authGuard } from '$lib/guards/auth';
import { session } from '$lib/stores/auth.store';
import { toastStore } from '@reborn/ui';
import { t } from '$lib/stores/i18n.store';
import { refreshDecryptedSubtasks } from '$lib/stores/decrypted-subtasks.store';
import { MAX_TASK_TITLE_BYTES, MAX_TASK_DESCRIPTION_BYTES } from '@reborn/types';
import type { TaskEncryptedBooleans, TaskDecrypted, TaskSensitiveMetadata } from '@reborn/types';

const logger = createLogger('TaskDetailService');

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'over_limit';

interface TaskDetailState {
	task: TaskEncryptedBooleans | null;
	decryptedTask: TaskDecrypted | null;
	parentTemplateId: string | null;
	parentTemplateRRule: string | null;
	isLoading: boolean;
	isLoadingTask: boolean;
	isSaving: boolean;
	isTrashed: boolean;
	saveStatus: SaveStatus;
	error: string | null;
}

class TaskDetailService {
	private state = writable<TaskDetailState>({
		task: null,
		decryptedTask: null,
		parentTemplateId: null,
		parentTemplateRRule: null,
		isLoading: false,
		isLoadingTask: false,
		isSaving: false,
		isTrashed: false,
		saveStatus: 'idle',
		error: null
	});

	// Derived stores for reactive access
	public task = derived(this.state, ($state) => $state.task);
	public decryptedTask = derived(this.state, ($state) => $state.decryptedTask);
	public parentTemplateId = derived(this.state, ($state) => $state.parentTemplateId);
	public parentTemplateRRule = derived(this.state, ($state) => $state.parentTemplateRRule);
	public isLoading = derived(this.state, ($state) => $state.isLoading);
	public isSaving = derived(this.state, ($state) => $state.isSaving);
	public isTrashed = derived(this.state, ($state) => $state.isTrashed);
	public saveStatus = derived(this.state, ($state) => $state.saveStatus);
	public error = derived(this.state, ($state) => $state.error);

	// Debounce timers
	private titleDebounceTimer?: NodeJS.Timeout;
	private descriptionDebounceTimer?: NodeJS.Timeout;
	private savedStatusTimer?: ReturnType<typeof setTimeout>;
	private readonly DEBOUNCE_MS = 1000;

	// Pending save tracking for flush
	private pendingTitle: string | null = null;
	private pendingDescription: string | null = null;

	constructor() {
		// Reset timers on cleanup
	}

	private clearTimers() {
		if (this.titleDebounceTimer) clearTimeout(this.titleDebounceTimer);
		if (this.descriptionDebounceTimer) clearTimeout(this.descriptionDebounceTimer);
		if (this.savedStatusTimer) {
			clearTimeout(this.savedStatusTimer);
			this.savedStatusTimer = undefined;
		}
	}

	private setSaveStatus(status: SaveStatus): void {
		if (this.savedStatusTimer) {
			clearTimeout(this.savedStatusTimer);
			this.savedStatusTimer = undefined;
		}
		this.updateState({ saveStatus: status });
		if (status === 'saved') {
			this.savedStatusTimer = setTimeout(() => {
				this.savedStatusTimer = undefined;
				this.updateState({ saveStatus: 'idle' });
			}, 2000);
		}
	}

	/**
	 * Check authentication and E2E access
	 */
	async checkAccess(taskId: string): Promise<boolean> {
		const $session = get(session);

		// Wait for session to be initialized
		if (!$session.isInitialized) {
			logger.debug('Session not initialized yet');
			return false;
		}

		// Check if user has E2E access
		const hasAccess = await authGuard({
			requireE2E: true,
			returnTo: `/tasks/${taskId}`
		});

		if (!hasAccess) {
			logger.info('No E2E access, auth guard will redirect');
			return false;
		}

		// Check if E2E is available in session
		if (!$session.hasE2E) {
			logger.warn('No E2E available in session');
			return false;
		}

		return true;
	}

	/**
	 * Load and decrypt task
	 */
	async loadTask(taskId: string, options?: { silent?: boolean }): Promise<void> {
		const state = get(this.state);

		if (!taskId) {
			logger.error('No taskId provided');
			this.updateState({ isLoading: false, error: 'No task ID' });
			return;
		}

		// Prevent multiple simultaneous loads
		if (state.isLoadingTask) {
			logger.warn('Already loading task, skipping...');
			return;
		}

		// Silent reload: don't set isLoading to avoid unmounting UI components (e.g. open popovers)
		const silent = options?.silent ?? false;
		if (silent) {
			this.updateState({ isLoadingTask: true, error: null });
		} else {
			this.updateState({ isLoading: true, isLoadingTask: true, error: null });
		}

		try {
			// CryptoManager should be initialized at this point
			if (!cryptoManager.isInitialized()) {
				throw new Error('CryptoManager not initialized');
			}

			// Get task from IndexedDB
			logger.info('Attempting to load task from IndexedDB', { taskId });
			const loadedTask = await taskStore.get(taskId);

			logger.info('Task loaded result:', {
				taskId,
				found: !!loadedTask,
				deleted: loadedTask?.deleted_at
			});

			if (!loadedTask) {
				logger.error('Task not found:', { taskId });
				this.updateState({
					isLoading: false,
					isLoadingTask: false,
					error: 'Task not found'
				});
				return;
			}

			const isTrashed = !!loadedTask.deleted_at;
			if (isTrashed) {
				logger.info('Task is in trash, loading in read-only mode', { taskId });
			}

			logger.info('Task loaded from IndexedDB', { taskId });

			// Decrypt task data
			const decrypted = await this.decryptTask(loadedTask);

			// If this is a recurring instance, load the parent template's recurrence rule
			let parentTemplateId: string | null = null;
			let parentTemplateRRule: string | null = null;
			if (loadedTask.parent_task_id) {
				const parentTemplate = await taskStore.get(loadedTask.parent_task_id);
				if (parentTemplate && parentTemplate.recurrence_rule_encrypted) {
					parentTemplateId = parentTemplate.id;
					parentTemplateRRule = await cryptoManager.decryptText(
						parentTemplate.recurrence_rule_encrypted
					);
				} else if (parentTemplate) {
					parentTemplateId = parentTemplate.id;
				}
			}

			this.updateState({
				task: loadedTask,
				decryptedTask: decrypted,
				parentTemplateId,
				parentTemplateRRule,
				isLoading: false,
				isLoadingTask: false,
				isTrashed,
				saveStatus: 'idle' as SaveStatus
			});

			// Ensure subtasks are loaded and decrypted for this task
			// CryptoManager is guaranteed initialized here (we just decrypted the task)
			await subtaskStore.refreshItems();
			await refreshDecryptedSubtasks();

			logger.info('Task decrypted successfully', { taskId });
		} catch (error: unknown) {
			logger.error('Failed to load task:', error);
			this.updateState({
				isLoading: false,
				isLoadingTask: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	}

	/**
	 * Decrypt task data — extracts sensitive fields from metadata_encrypted bundle.
	 */
	private async decryptTask(task: TaskEncryptedBooleans): Promise<TaskDecrypted> {
		// Decrypt metadata bundle
		let meta: TaskSensitiveMetadata | null = null;
		try {
			if (task.metadata_encrypted) {
				meta = await cryptoManager.decryptObject<TaskSensitiveMetadata>(task.metadata_encrypted);
			}
		} catch {
			meta = null;
		}

		return {
			id: task.id,
			task_list_id: task.task_list_id,
			parent_task_id: task.parent_task_id,
			is_template: task.is_template,
			title: await cryptoManager.decryptText(task.title_encrypted),
			description: task.description_encrypted
				? await cryptoManager.decryptText(task.description_encrypted)
				: '',
			// Shadow indexes (available directly on TaskEncryptedBooleans)
			due_date: task.due_date ?? undefined,
			is_completed: task.is_completed,
			is_starred: task.is_starred,
			is_recurring: task.is_recurring || false,
			// From decrypted metadata
			has_time: meta?.has_time,
			completed_at: meta?.completed_at,
			next_occurrence_date: meta?.next_occurrence_date,
			recurrence_base_date: meta?.recurrence_base_date,
			completed_occurrences_count: meta?.completed_occurrences_count,
			reminder_date: meta?.reminder_date,
			notification_sent: meta?.notification_sent,
			// Encrypted fields
			recurrence_rule: task.recurrence_rule_encrypted
				? await cryptoManager.decryptText(task.recurrence_rule_encrypted)
				: undefined,
			position: task.position,
			created_at: task.created_at,
			updated_at: task.updated_at,
			deleted_at: task.deleted_at || undefined
		};
	}

	/**
	 * Save title with debounce
	 */
	saveTitleDebounced(newTitle: string): void {
		if (get(this.state).isTrashed) return;

		const titleSize = new Blob([newTitle]).size;
		if (titleSize > MAX_TASK_TITLE_BYTES) {
			this.setSaveStatus('over_limit');
			logger.warn(`Title exceeds size limit: ${titleSize} / ${MAX_TASK_TITLE_BYTES}`);
			return;
		}

		if (this.titleDebounceTimer) clearTimeout(this.titleDebounceTimer);
		this.pendingTitle = newTitle;
		this.setSaveStatus('dirty');
		this.titleDebounceTimer = setTimeout(() => {
			this.pendingTitle = null;
			this.titleDebounceTimer = undefined;
			this.saveTitle(newTitle);
		}, this.DEBOUNCE_MS);
	}

	/**
	 * Save description with debounce
	 */
	saveDescriptionDebounced(newDescription: string): void {
		if (get(this.state).isTrashed) return;

		const descSize = new Blob([newDescription]).size;
		if (descSize > MAX_TASK_DESCRIPTION_BYTES) {
			this.setSaveStatus('over_limit');
			logger.warn(`Description exceeds size limit: ${descSize} / ${MAX_TASK_DESCRIPTION_BYTES}`);
			return;
		}

		if (this.descriptionDebounceTimer) clearTimeout(this.descriptionDebounceTimer);
		this.pendingDescription = newDescription;
		this.setSaveStatus('dirty');
		this.descriptionDebounceTimer = setTimeout(() => {
			this.pendingDescription = null;
			this.descriptionDebounceTimer = undefined;
			this.saveDescription(newDescription);
		}, this.DEBOUNCE_MS);
	}

	/**
	 * Save title
	 */
	private async saveTitle(newTitle: string): Promise<void> {
		const state = get(this.state);
		if (!state.task || !newTitle.trim()) return;

		this.setSaveStatus('saving');

		try {
			await taskOperationsService.updateTask(state.task.id, {
				title: newTitle.trim()
			});

			this.setSaveStatus('saved');
		} catch (error: unknown) {
			logger.error('Failed to update title:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.update_failed'));
			this.setSaveStatus('idle');
		}
	}

	/**
	 * Save description
	 */
	private async saveDescription(newDescription: string): Promise<void> {
		const state = get(this.state);
		if (!state.task) return;

		this.setSaveStatus('saving');

		try {
			await taskOperationsService.updateTask(state.task.id, {
				description: newDescription.trim()
			});

			this.setSaveStatus('saved');
		} catch (error: unknown) {
			logger.error('Failed to update description:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.update_failed'));
			this.setSaveStatus('idle');
		}
	}

	/**
	 * Update task properties
	 */
	async updateProperties(updates: Partial<TaskDecrypted>): Promise<void> {
		const state = get(this.state);
		if (!state.task || state.isTrashed) return;

		this.updateState({ isSaving: true });
		this.setSaveStatus('saving');

		try {
			await taskOperationsService.updateTask(state.task.id, updates);

			// Reload task to get updated data (silent to avoid unmounting open popovers)
			await this.loadTask(state.task.id, { silent: true });

			this.setSaveStatus('saved');
		} catch (error: unknown) {
			logger.error('Failed to update task properties:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.update_failed'));
			this.setSaveStatus('idle');
		} finally {
			this.updateState({ isSaving: false });
		}
	}

	/**
	 * Toggle star status
	 */
	async toggleStar(): Promise<void> {
		const state = get(this.state);
		if (!state.task || state.isTrashed) return;

		try {
			await taskOperationsService.toggleStarred(state.task.id);

			// Update local state immediately for responsiveness
			const newStarredStatus = !state.task.is_starred;
			this.updateState({
				task: { ...state.task, is_starred: newStarredStatus },
				decryptedTask: state.decryptedTask
					? { ...state.decryptedTask, is_starred: newStarredStatus }
					: null
			});

			this.setSaveStatus('saved');
		} catch (error: unknown) {
			logger.error('Failed to toggle star:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.update_failed'));
		}
	}

	/**
	 * Toggle completion status
	 */
	async toggleCompleted(): Promise<void> {
		const state = get(this.state);
		if (!state.task || state.isTrashed) return;

		try {
			logger.info('Toggling completion status', {
				taskId: state.task.id,
				currentStatus: state.task.is_completed
			});

			// Update local state immediately for responsiveness
			const newCompletedStatus = !state.task.is_completed;
			this.updateState({
				task: { ...state.task, is_completed: newCompletedStatus },
				decryptedTask: state.decryptedTask
					? { ...state.decryptedTask, is_completed: newCompletedStatus }
					: null
			});

			// Wait for state update to propagate
			await tick();

			// Now update in the database
			await taskOperationsService.toggleCompleted(state.task.id);

			this.setSaveStatus('saved');

			logger.info('Completion status toggled successfully', {
				taskId: state.task.id,
				newStatus: newCompletedStatus
			});
		} catch (error: unknown) {
			logger.error('Failed to toggle completion:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.update_failed'));
			// Revert state on error
			await this.loadTask(state.task.id, { silent: true });
		}
	}

	/**
	 * Delete task
	 */
	async deleteTask(option?: 'this_only' | 'future'): Promise<void> {
		const state = get(this.state);
		if (!state.task) return;

		const taskId = state.task.id;
		const listId = state.task.task_list_id;

		try {
			// Check if this is a recurring instance and we need special handling
			if (state.task.parent_task_id && option) {
				await taskOperationsService.deleteRecurringInstance(taskId, option);
			} else {
				await taskOperationsService.deleteTask(taskId);
			}

			const $t = get(t);
			toastStore.success($t('task.success.deleted'), {
				action: {
					label: $t('common.undo'),
					onClick: () => {
						void taskOperationsService
							.updateTask(taskId, {
								deleted_at: undefined
							})
							.then(() => {
								toastStore.success($t('task.success.restored'));
							});
					}
				}
			});

			// Navigate back to list
			await goto(`/lists/${listId}`);
		} catch (error: unknown) {
			logger.error('Failed to delete task:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.delete_failed'));
		}
	}

	/**
	 * Move task to another list
	 */
	async moveToList(targetListId: string): Promise<void> {
		const state = get(this.state);
		if (!state.task) return;

		try {
			await taskOperationsService.moveTasksToList([state.task.id], targetListId);
			const $t = get(t);
			toastStore.success($t('task.success.moved'));

			// Navigate to the new list
			await goto(`/lists/${targetListId}`);
		} catch (error: unknown) {
			logger.error('Failed to move task:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.move_failed'));
		}
	}

	/**
	 * Skip this recurring instance (soft-delete, no undo) and navigate back
	 */
	async skipInstance(): Promise<void> {
		const state = get(this.state);
		if (!state.task || !state.task.parent_task_id) return;

		const listId = state.task.task_list_id;
		try {
			await recurrenceService.skipInstance(state.task.id);
			const $t = get(t);
			toastStore.success($t('task.recurring_instance.skip_success'));
			await goto(`/lists/${listId}`);
		} catch (error: unknown) {
			logger.error('Failed to skip instance:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.delete_failed'));
		}
	}

	/**
	 * Stop the recurrence cycle (delete all future instances, remove rule from template)
	 */
	async stopRecurrence(): Promise<void> {
		const state = get(this.state);
		if (!state.task || !state.task.parent_task_id) return;

		const listId = state.task.task_list_id;
		this.updateState({ isSaving: true });
		try {
			await recurrenceService.stopRecurrence(state.task.id);
			const $t = get(t);
			toastStore.success($t('task.recurring_instance.stop_cycle_success'));
			await goto(`/lists/${listId}`);
		} catch (error: unknown) {
			logger.error('Failed to stop recurrence:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.update_failed'));
		} finally {
			this.updateState({ isSaving: false });
		}
	}

	/**
	 * Edit the recurrence rule from an instance with scope option
	 */
	async editRecurrenceFromInstance(
		newRRule: string | null,
		option: 'this_and_future' | 'all'
	): Promise<void> {
		const state = get(this.state);
		if (!state.task || !state.task.parent_task_id) return;

		this.updateState({ isSaving: true });
		try {
			await recurrenceService.editRecurrenceFromInstance(state.task.id, newRRule, option);
			const $t = get(t);
			toastStore.success($t('task.recurring_instance.edit_success'));
			// Reload to get fresh template rule
			await this.loadTask(state.task.id, { silent: true });
		} catch (error: unknown) {
			logger.error('Failed to edit recurrence from instance:', error);
			const $t = get(t);
			toastStore.error($t('task.errors.update_failed'));
		} finally {
			this.updateState({ isSaving: false });
		}
	}

	/**
	 * Check if there are pending debounced changes
	 */
	hasPendingChanges(): boolean {
		return this.pendingTitle !== null || this.pendingDescription !== null;
	}

	/**
	 * Flush pending debounced saves immediately.
	 * Returns true if all saves succeeded or there were no pending changes.
	 */
	async flushPendingSave(): Promise<boolean> {
		this.clearTimers();

		const title = this.pendingTitle;
		const description = this.pendingDescription;
		this.pendingTitle = null;
		this.pendingDescription = null;

		if (title === null && description === null) return true;

		// Block flush if either field exceeds size limit
		if (
			(title !== null && new Blob([title]).size > MAX_TASK_TITLE_BYTES) ||
			(description !== null && new Blob([description]).size > MAX_TASK_DESCRIPTION_BYTES)
		) {
			this.setSaveStatus('over_limit');
			logger.warn('Flush blocked: field exceeds size limit');
			return false;
		}

		try {
			if (title !== null) await this.saveTitle(title);
			if (description !== null) await this.saveDescription(description);
			return true;
		} catch (error: unknown) {
			logger.error('Failed to flush pending save:', error);
			return false;
		}
	}

	/**
	 * Reset service state
	 */
	reset(): void {
		this.clearTimers();
		this.pendingTitle = null;
		this.pendingDescription = null;
		this.state.set({
			task: null,
			decryptedTask: null,
			parentTemplateId: null,
			parentTemplateRRule: null,
			isLoading: false,
			isLoadingTask: false,
			isSaving: false,
			isTrashed: false,
			saveStatus: 'idle',
			error: null
		});
	}

	/**
	 * Update state helper
	 */
	private updateState(updates: Partial<TaskDetailState>): void {
		logger.debug('Updating state with:', updates);
		this.state.update((state) => {
			const newState = { ...state, ...updates };
			logger.debug('New state:', {
				taskId: newState.task?.id,
				task_is_completed: newState.task?.is_completed,
				decryptedTask_is_completed: newState.decryptedTask?.is_completed
			});
			return newState;
		});
	}
}

// Export singleton instance
export const taskDetailService = new TaskDetailService();
