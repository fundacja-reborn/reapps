<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$lib/utils/navigation';
	import { browser } from '$app/environment';
	import { beforeNavigate } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import {
		Skeleton,
		toastStore,
		Button,
		Tooltip,
		TooltipContent,
		TooltipTrigger,
		TooltipProvider,
		Alert,
		AlertDescription
	} from '@reborn/ui';
	import { Lock, Trash2, Undo2, AlertTriangle } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import {
		TaskTitleEditor,
		TaskDescriptionEditor,
		TaskProperties,
		RecurringInstancePanel,
		DeleteTaskDialog,
		MoveTaskDialog
	} from '$lib/components/tasks';
	import { SubtaskList } from '$lib/components/subtasks';
	import { taskDetailService } from '$lib/services/task-detail.service';
	import { trashManagementService } from '$lib/services/trash-management.service';
	import { taskIndex } from '$lib/services/task-title-index.svelte';
	import { decryptedLists } from '$lib/stores/decrypted-lists.store';
	import { session } from '$lib/stores/auth.store';
	import { createLogger } from '@reborn/utils';
	import { ConfirmDialog } from '$lib/components/shared/dialogs';
	import { MAX_TASK_TITLE_BYTES, MAX_TASK_DESCRIPTION_BYTES } from '@reborn/types';
	import type { ListDecrypted, TaskDecrypted } from '@reborn/types';

	const logger = createLogger('TaskDetailPage');

	// Get taskId from route params
	let taskId = $derived($page.params.taskId);

	// Get stores from service
	const taskStore = taskDetailService.task;
	const decryptedTaskStore = taskDetailService.decryptedTask;
	const isLoadingStore = taskDetailService.isLoading;
	const isSavingStore = taskDetailService.isSaving;
	const isTrashedStore = taskDetailService.isTrashed;
	const errorStore = taskDetailService.error;
	const parentTemplateIdStore = taskDetailService.parentTemplateId;
	const parentTemplateRRuleStore = taskDetailService.parentTemplateRRule;
	const saveStatusStore = taskDetailService.saveStatus;

	// Service state - use $ for automatic store subscription
	let task = $derived($taskStore);
	let decryptedTask = $derived($decryptedTaskStore);
	let isLoading = $derived($isLoadingStore);
	let isSaving = $derived($isSavingStore);
	let isTrashed = $derived($isTrashedStore);
	let error = $derived($errorStore);
	let parentTemplateId = $derived($parentTemplateIdStore);
	let parentTemplateRRule = $derived($parentTemplateRRuleStore);
	let saveStatus = $derived($saveStatusStore);

	// Task list
	let taskList = $state<ListDecrypted | null>(null);

	// Dialog states
	let deleteDialogOpen = $state(false);
	let moveTaskDialogOpen = $state(false);
	let deleteDialogIsRecurring = $state(false);
	let confirmPermanentDeleteOpen = $state(false);
	let isTrashActionLoading = $state(false);

	// Reactive bindings for task properties
	let taskTitle = $state('');
	let taskDescription = $state('');

	// Title size tracking
	let titleSize = $derived(new Blob([taskTitle]).size);
	let isTitleOverLimit = $derived(titleSize > MAX_TASK_TITLE_BYTES);

	// Description size tracking
	let descriptionSize = $derived(new Blob([taskDescription]).size);
	let descriptionPercent = $derived(
		MAX_TASK_DESCRIPTION_BYTES > 0 ? (descriptionSize / MAX_TASK_DESCRIPTION_BYTES) * 100 : 0
	);
	let showDescriptionSizeIndicator = $derived(descriptionPercent >= 80);
	let isDescriptionOverLimit = $derived(descriptionPercent > 100);

	function formatKB(bytes: number): string {
		return `${Math.round(bytes / 1024)} KB`;
	}

	// Update task properties when decryptedTask changes
	$effect(() => {
		if (decryptedTask) {
			logger.debug('decryptedTask changed:', {
				id: decryptedTask.id,
				is_completed: decryptedTask.is_completed,
				title: decryptedTask.title
			});
			// Guard: only update if values actually changed (avoid re-render after save)
			// Use untrack() so local values don't become reactive dependencies
			const currentTitle = untrack(() => taskTitle);
			if (currentTitle !== decryptedTask.title) {
				taskTitle = decryptedTask.title;
			}
			const newDescription = decryptedTask.description || '';
			const currentDescription = untrack(() => taskDescription);
			if (currentDescription !== newDescription) {
				taskDescription = newDescription;
			}
		}
	});

	// Handle errors
	$effect(() => {
		if (error) {
			logger.error('Task detail error:', error);
			if (error === 'Task not found') {
				toastStore.error($t('task.errors.not_found'));
				goto('/').catch((err) => logger.error('Failed to navigate:', err));
			} else {
				toastStore.error($t('task.errors.load_failed'));
			}
		}
	});

	// Cleanup on unmount
	$effect(() => {
		return () => {
			taskDetailService.reset();
		};
	});

	// Flush pending saves before SvelteKit navigation
	beforeNavigate(({ cancel, to }) => {
		if (taskDetailService.hasPendingChanges()) {
			cancel();
			taskDetailService.flushPendingSave().then((ok) => {
				if (ok && to?.url) {
					goto(to.url.pathname + to.url.search + to.url.hash);
				}
			});
		}
	});

	// beforeunload + visibilitychange — ostatnia linia obrony
	onMount(() => {
		function handleBeforeUnload(e: BeforeUnloadEvent) {
			if (taskDetailService.hasPendingChanges()) {
				e.preventDefault();
			}
		}

		function handleVisibilityChange() {
			if (document.visibilityState === 'hidden' && taskDetailService.hasPendingChanges()) {
				taskDetailService.flushPendingSave();
			}
		}

		window.addEventListener('beforeunload', handleBeforeUnload);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});

	// Get task's list
	$effect(() => {
		if (task && $decryptedLists.length > 0) {
			taskList = $decryptedLists.find((list) => list.id === task.task_list_id) || null;
		}
	});

	// Load task when component mounts and session is ready
	$effect(() => {
		if (!browser || !taskId) return;

		// Wait for session to be initialized
		if (!$session.isInitialized) {
			logger.debug('Session not initialized yet, waiting...');
			return;
		}

		let cancelled = false;

		const loadTask = async () => {
			const hasAccess = await taskDetailService.checkAccess(taskId);
			if (cancelled) return;
			if (hasAccess) {
				await taskDetailService.loadTask(taskId);
			}
		};

		loadTask();

		return () => {
			cancelled = true;
		};
	});

	// Leave the detail view when the currently-open ACTIVE task gets soft-deleted
	// elsewhere - e.g. "empty completed" while this task is open. The task then
	// lives in trash and is only reachable (read-only) from the trash view, so the
	// stale, still-interactive detail must not linger. Mirrors single-delete, which
	// already navigates to the task's list. A task opened directly from trash
	// (isTrashed at load) is exempt: we gate on `task` being loaded so the freshly
	// mounted trash view - where isTrashed only flips true once loadTask resolves -
	// is never mistaken for an active task that just got trashed.
	let hasLeftTrashedTask = false;
	$effect(() => {
		if (!browser) return;
		const id = taskId;
		if (!id || !task || isTrashed || hasLeftTrashedTask) return;
		void taskIndex.version; // subscribe to in-memory index mutations
		if (taskIndex.get(id)?.isDeleted) {
			hasLeftTrashedTask = true;
			const listId = task.task_list_id;
			goto(listId ? `/lists/${listId}` : '/').catch((err) =>
				logger.error('Failed to navigate after open task was trashed:', err)
			);
		}
	});

	// Handle title change
	function handleTitleChange(newTitle: string) {
		taskTitle = newTitle;
		taskDetailService.saveTitleDebounced(newTitle);
	}

	// Handle description change
	function handleDescriptionChange(newDescription: string) {
		taskDescription = newDescription;
		taskDetailService.saveDescriptionDebounced(newDescription);
	}

	// Handle properties update
	async function handlePropertiesUpdate(updates: Partial<TaskDecrypted>) {
		// When clearing the date of a recurring instance, also detach it from the template
		if ('due_date' in updates && !updates.due_date && decryptedTask?.parent_task_id) {
			updates = { ...updates, parent_task_id: undefined };
		}
		await taskDetailService.updateProperties(updates);
	}

	// Handle actions
	async function handleToggleCompleted() {
		await taskDetailService.toggleCompleted();
	}

	async function handleToggleStar() {
		await taskDetailService.toggleStar();
	}

	async function handleMoveToList(listId: string) {
		await taskDetailService.moveToList(listId);
	}

	async function handleDeleteConfirm(option?: 'this_only' | 'future') {
		await taskDetailService.deleteTask(option);
	}

	function handleDeleteClick() {
		logger.info('[TaskDetailPage] handleDeleteClick called');

		if (!decryptedTask) {
			logger.warn('handleDeleteClick called but decryptedTask is null');
			return;
		}

		const isRecurring = !!decryptedTask.parent_task_id;
		logger.info('[TaskDetailPage] handleDeleteClick - task data:', {
			taskId: decryptedTask.id,
			parent_task_id: decryptedTask.parent_task_id,
			isRecurringInstance: isRecurring,
			beforeState: deleteDialogIsRecurring
		});

		// Set dialog state before opening
		deleteDialogIsRecurring = isRecurring;
		deleteDialogOpen = true;

		logger.info('[TaskDetailPage] After setting state:', {
			deleteDialogIsRecurring,
			deleteDialogOpen
		});
	}

	// Trash actions
	async function handleRestoreFromTrash() {
		if (!task || isTrashActionLoading) return;
		try {
			isTrashActionLoading = true;
			await trashManagementService.restoreTask(task.id);
			toastStore.success($t('task.trash.restored'));
			await goto('/');
		} catch (err: unknown) {
			logger.error('Failed to restore task from trash:', err);
			toastStore.error($t('task.trash.restore_failed'));
		} finally {
			isTrashActionLoading = false;
		}
	}

	async function handlePermanentDelete() {
		if (!task || isTrashActionLoading) return;
		try {
			isTrashActionLoading = true;
			await trashManagementService.permanentlyDeleteTask(task.id);
			toastStore.success($t('task.trash.permanently_deleted'));
			await goto('/trash');
		} catch (err: unknown) {
			logger.error('Failed to permanently delete task:', err);
			toastStore.error($t('task.trash.delete_failed'));
		} finally {
			isTrashActionLoading = false;
		}
	}

	function goBack() {
		if (isTrashed) {
			goto('/trash');
		} else if (task) {
			goto(`/lists/${task.task_list_id}`);
		} else {
			goto('/');
		}
	}
</script>

<div class="container mx-auto p-6 max-w-3xl">
	{#if !$session.isInitialized}
		<!-- Waiting for session initialization -->
		<div class="flex items-center justify-center py-12">
			<p class="text-lg text-muted-foreground">{$t('common.loading')}</p>
		</div>
	{:else if !$session.isAuthenticated && !$session.isLocalOnly}
		<!-- Not authenticated (local-only mode is a valid, accountless state and must pass) -->
		<div class="flex items-center justify-center py-12">
			<p class="text-lg text-muted-foreground">{$t('auth.login_required')}</p>
		</div>
	{:else if !$session.hasE2E}
		<!-- Waiting for E2E -->
		<div class="flex items-center justify-center py-12">
			<p class="text-lg text-muted-foreground">{$t('auth.e2e_required')}</p>
		</div>
	{:else if isLoading}
		<!-- Loading skeleton -->
		<div class="space-y-3">
			<Skeleton class="h-8 w-32" />
			<Skeleton class="h-12 w-full" />
			<Skeleton class="h-32 w-full" />
		</div>
	{:else if task && decryptedTask}
		<!-- Trash banner -->
		{#if isTrashed}
			<div class="mb-6 rounded-lg border border-warning bg-warning/10 p-4">
				<div class="flex items-start gap-3">
					<AlertTriangle class="h-5 w-5 text-warning mt-0.5 shrink-0" />
					<div class="flex-1 min-w-0">
						<p class="font-medium text-sm">{$t('task.trash.banner_message')}</p>
						<p class="text-xs text-muted-foreground mt-0.5">
							{$t('task.trash.banner_restore_hint')}
						</p>
					</div>
				</div>
				<div class="flex items-center gap-2 mt-3 ml-8">
					<Button
						variant="outline"
						size="sm"
						onclick={handleRestoreFromTrash}
						disabled={isTrashActionLoading}
					>
						<Undo2 class="h-4 w-4 mr-1.5" />
						{$t('task.trash.restore')}
					</Button>
					<Button
						variant="destructive"
						size="sm"
						onclick={() => (confirmPermanentDeleteOpen = true)}
						disabled={isTrashActionLoading}
					>
						<Trash2 class="h-4 w-4 mr-1.5" />
						{$t('task.trash.permanently_delete')}
					</Button>
				</div>
			</div>
		{/if}

		<!-- Task title -->
		<div class="mb-6">
			<TaskTitleEditor
				value={taskTitle}
				disabled={isSaving || isTrashed}
				isCompleted={decryptedTask?.is_completed ?? false}
				placeholder={$t('task.placeholders.title')}
				class="text-xl font-semibold"
				onValueChanged={handleTitleChange}
			/>
			{#if isTitleOverLimit}
				<p class="mt-1.5 flex items-center gap-1 text-xs text-destructive">
					<AlertTriangle class="h-3 w-3 shrink-0" />
					{$t('task.errors.title_too_long', { values: { max: formatKB(MAX_TASK_TITLE_BYTES) } })}
				</p>
			{/if}
		</div>

		<!-- Task content -->
		<div class="space-y-3">
			<!-- Task properties (date, recurrence) -->
			<TaskProperties
				dueDate={decryptedTask?.due_date ?? undefined}
				hasTime={decryptedTask?.has_time ?? false}
				isRecurring={decryptedTask?.is_recurring ?? false}
				recurrenceRule={decryptedTask?.recurrence_rule ?? null}
				isSaving={isSaving || isTrashed}
				hideRecurrence={!!decryptedTask?.parent_task_id}
				onUpdate={(updates) =>
					handlePropertiesUpdate({
						...updates,
						recurrence_rule: updates.recurrence_rule ?? undefined
					})}
			/>

			<!-- Recurring instance controls (visible when this task is an instance of a recurring template) -->
			{#if decryptedTask.parent_task_id && parentTemplateId && !isTrashed}
				<RecurringInstancePanel
					instanceId={decryptedTask.id}
					templateId={parentTemplateId}
					recurrenceRule={parentTemplateRRule}
					{isSaving}
				/>
			{/if}

			<!-- Subtasks -->
			<div class="mb-7">
				<SubtaskList taskId={task.id} disabled={isSaving || isTrashed} />
			</div>

			<!-- Description -->
			<div class="mt-5">
				<div class="flex items-center gap-2 mb-1.5">
					<span class="text-base text-muted-foreground">{$t('task.fields.description')}</span>
					{#if showDescriptionSizeIndicator}
						<span
							class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums
								{isDescriptionOverLimit
								? 'bg-destructive/10 text-destructive'
								: 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}"
						>
							{formatKB(descriptionSize)} / {formatKB(MAX_TASK_DESCRIPTION_BYTES)}
						</span>
					{/if}
					{#if saveStatus === 'over_limit'}
						<span
							class="text-destructive"
							title={$t('task.errors.description_too_long', {
								values: { max: formatKB(MAX_TASK_DESCRIPTION_BYTES) }
							})}
						>
							<AlertTriangle class="h-4 w-4" />
						</span>
					{/if}
				</div>
				<TaskDescriptionEditor
					value={taskDescription}
					disabled={isSaving || isTrashed}
					placeholder={$t('task.placeholders.add_description')}
					class="text-base"
					onValueChanged={handleDescriptionChange}
				/>
			</div>
		</div>
	{:else}
		<!-- Error state -->
		<div class="text-center py-12">
			<p class="text-lg text-muted-foreground">{$t('task.errors.not_found')}</p>
			<Button onclick={goBack} class="mt-4">
				{$t('common.go_back')}
			</Button>
		</div>
	{/if}
</div>

<!-- E2EE badge — page footer -->
{#if task && decryptedTask}
	<div class="mt-auto flex justify-center pb-6 pt-12">
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger>
					{#snippet child({ props })}
						<span
							{...props}
							class="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50"
						>
							<Lock class="h-3 w-3" />
							{$t('e2e.badge')}
						</span>
					{/snippet}
				</TooltipTrigger>
				<TooltipContent>
					<p>{$t('e2e.badge_tooltip')}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	</div>
{/if}

<!-- Dialogs -->
{#if decryptedTask && task && !isTrashed}
	<DeleteTaskDialog
		bind:open={deleteDialogOpen}
		taskTitle={decryptedTask.title}
		isRecurringInstance={deleteDialogIsRecurring}
		onConfirm={handleDeleteConfirm}
		onClose={() => {
			deleteDialogOpen = false;
			deleteDialogIsRecurring = false;
		}}
	/>

	<MoveTaskDialog
		bind:open={moveTaskDialogOpen}
		task={decryptedTask}
		onMoveToList={handleMoveToList}
		onToggleCompleted={handleToggleCompleted}
		onDelete={handleDeleteClick}
	/>
{/if}

<!-- Confirm permanent delete dialog (trash mode) -->
{#if decryptedTask && isTrashed}
	<ConfirmDialog
		bind:open={confirmPermanentDeleteOpen}
		title={$t('task.trash.confirm_delete_title')}
		description={$t('task.trash.confirm_delete_description', {
			values: { title: decryptedTask.title }
		})}
		confirmText={$t('common.delete')}
		cancelText={$t('common.cancel')}
		variant="destructive"
		onConfirm={handlePermanentDelete}
	/>
{/if}
