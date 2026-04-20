<script lang="ts">
	import { onMount } from 'svelte';
	import { Trash2, Undo2, Trash, AlertTriangle, MoreVertical } from '@lucide/svelte';
	import {
		Button,
		Alert,
		AlertDescription,
		Sheet,
		SheetContent,
		SheetHeader,
		SheetTitle
	} from '@reborn/ui';
	import * as DropdownMenu from '@reborn/ui/components/dropdown-menu';
	import { t } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { decryptedTrashTasks, getDaysInTrash } from '$lib/stores/decrypted-trash.store';
	import { trashManagementService } from '$lib/services/trash-management.service';
	import { notificationService } from '$lib/services/notification.service';
	import { decryptedLists } from '$lib/stores/decrypted-lists.store';
	import { ConfirmDialog } from '$lib/components/shared/dialogs';
	import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
	import type { TaskListItem } from '$lib/services/task-title-index.svelte';
	import type { ListDecrypted } from '@reborn/types';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('task:trash');

	const isMobileQuery = useIsMobile();
	const isMobile = $derived(isMobileQuery.value);

	// Trash tasks from store
	let trashTasks = $state<TaskListItem[]>([]);
	let lists = $state<ListDecrypted[]>([]);
	let isLoading = $state(false);

	// Dialog states
	let confirmPermanentDeleteOpen = $state(false);
	let confirmEmptyTrashOpen = $state(false);
	let taskToDelete = $state<TaskListItem | null>(null);

	// Mobile action sheet state
	let actionSheetOpen = $state(false);
	let activeMenuTask = $state<TaskListItem | null>(null);

	// Subscribe to stores
	$effect(() => {
		trashTasks = $decryptedTrashTasks;
		lists = $decryptedLists;
	});

	// Auto-purge old tasks on mount
	onMount(async () => {
		try {
			const purgedCount = await trashManagementService.purgeOldTasks();
			if (purgedCount > 0) {
				notificationService.info($t('task.trash.auto_purged', { values: { count: purgedCount } }));
			}
		} catch (error: unknown) {
			logger.error('Failed to auto-purge old tasks:', error);
		}
	});

	// Get list name for a task
	function getListName(listId: string): string {
		const list = lists.find((l) => l.id === listId);
		return list?.name || $t('task.trash.unknown_list');
	}

	// Format date
	function formatDate(dateString: string): string {
		const date = new Date(dateString);
		return date.toLocaleDateString('pl-PL', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Navigate to task detail (read-only preview)
	function handleTaskClick(taskId: string) {
		goto(`/tasks/${taskId}`);
	}

	// Open mobile action sheet
	function openActionSheet(task: TaskListItem) {
		activeMenuTask = task;
		actionSheetOpen = true;
	}

	// Restore task
	async function handleRestoreTask(task: TaskListItem) {
		if (isLoading) return;
		actionSheetOpen = false;
		activeMenuTask = null;

		try {
			isLoading = true;
			await trashManagementService.restoreTask(task.id);
			notificationService.success($t('task.trash.restored'));
		} catch (error: unknown) {
			notificationService.error($t('task.trash.restore_failed'));
			logger.error('Failed to restore task:', error);
		} finally {
			isLoading = false;
		}
	}

	// Confirm permanent delete
	function confirmPermanentDelete(task: TaskListItem) {
		actionSheetOpen = false;
		activeMenuTask = null;
		taskToDelete = task;
		confirmPermanentDeleteOpen = true;
	}

	// Reset task to delete when dialog closes
	$effect(() => {
		if (!confirmPermanentDeleteOpen) {
			taskToDelete = null;
		}
	});

	// Permanently delete task
	async function handlePermanentDelete() {
		if (!taskToDelete || isLoading) return;

		try {
			isLoading = true;
			await trashManagementService.permanentlyDeleteTask(taskToDelete.id);
			notificationService.success($t('task.trash.permanently_deleted'));
			confirmPermanentDeleteOpen = false;
			taskToDelete = null;
		} catch (error: unknown) {
			notificationService.error($t('task.trash.delete_failed'));
			logger.error('Failed to permanently delete task:', error);
		} finally {
			isLoading = false;
		}
	}

	// Empty trash
	async function handleEmptyTrash() {
		if (isLoading) return;

		try {
			isLoading = true;
			await trashManagementService.emptyTrash();
			notificationService.success($t('task.trash.emptied'));
			confirmEmptyTrashOpen = false;
		} catch (error: unknown) {
			notificationService.error($t('task.trash.empty_failed'));
			logger.error('Failed to empty trash:', error);
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="container mx-auto p-4 max-w-4xl">
	{#if trashTasks.length > 0}
		<Alert class="mb-6">
			<AlertTriangle class="h-4 w-4" />
			<AlertDescription>
				{$t('task.trash.auto_delete_info')}
			</AlertDescription>
		</Alert>

		<div class="mb-4 flex justify-between items-center">
			<p class="text-sm text-muted-foreground">
				{$t('task.trash.count', { values: { count: trashTasks.length } })}
			</p>
			<Button
				variant="destructive"
				size="sm"
				onclick={() => (confirmEmptyTrashOpen = true)}
				disabled={isLoading}
			>
				<Trash class="h-4 w-4 mr-2" />
				{$t('task.trash.empty_trash')}
			</Button>
		</div>

		<div class="space-y-2">
			{#each trashTasks as task}
				{@const daysInTrash = getDaysInTrash(task.deleted_at!)}
				{@const willAutoDelete = daysInTrash > 23}

				<div
					class="group flex items-center gap-3 p-3 rounded-lg task-item-bg {willAutoDelete
						? 'ring-1 ring-warning'
						: ''}"
				>
					<!-- Clickable content area — navigates to task detail -->
					<button
						type="button"
						class="flex-1 min-w-0 text-left cursor-pointer"
						onclick={() => handleTaskClick(task.id)}
					>
						<h3
							class="font-medium text-sm {task.is_completed
								? 'line-through text-muted-foreground'
								: ''}"
						>
							{task.title}
						</h3>

						<!-- Metadata -->
						<div class="flex items-center gap-2 mt-2 text-xs flex-wrap">
							<div class="flex items-center gap-1 text-muted-foreground">
								<span>{$t('task.trash.from_list')}: {getListName(task.task_list_id)}</span>
							</div>
							<span class="text-muted-foreground">•</span>
							<div class="flex items-center gap-1 text-muted-foreground">
								<span>{$t('task.trash.deleted_on')}: {formatDate(task.deleted_at!)}</span>
							</div>
							{#if willAutoDelete}
								<span class="text-muted-foreground">•</span>
								<div class="flex items-center gap-1">
									<AlertTriangle class="h-3.5 w-3.5 task-date-overdue" />
									<span class="task-date-overdue font-medium">
										{$t('task.trash.auto_delete_warning', { values: { days: 30 - daysInTrash } })}
									</span>
								</div>
							{/if}
						</div>
					</button>

					<!-- Action menu -->
					{#if isMobile}
						<!-- Mobile: trigger action sheet -->
						<Button
							variant="ghost"
							size="icon"
							class="h-8 w-8 shrink-0"
							onclick={() => openActionSheet(task)}
							disabled={isLoading}
							aria-label={$t('task.trash.restore')}
						>
							<MoreVertical class="h-4 w-4" />
						</Button>
					{:else}
						<!-- Desktop: dropdown menu -->
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon"
										class="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
										disabled={isLoading}
									>
										<MoreVertical class="h-4 w-4" />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="w-44">
								<DropdownMenu.Item onclick={() => handleRestoreTask(task)}>
									<Undo2 class="h-3.5 w-3.5 mr-2" />
									{$t('task.trash.restore')}
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									class="text-destructive focus:text-destructive"
									onclick={() => confirmPermanentDelete(task)}
								>
									<Trash class="h-3.5 w-3.5 mr-2" />
									{$t('task.trash.permanently_delete')}
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<div class="rounded-lg task-item-bg p-12 text-center">
			<Trash2 class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
			<p class="text-muted-foreground">
				{$t('task.trash.empty')}
			</p>
		</div>
	{/if}
</div>

<!-- Mobile: Action sheet -->
<Sheet bind:open={actionSheetOpen}>
	<SheetContent side="bottom" class="h-auto">
		<SheetHeader>
			<SheetTitle>{activeMenuTask?.title || ''}</SheetTitle>
		</SheetHeader>
		<div class="mt-4 space-y-1">
			<Button
				variant="ghost"
				class="w-full justify-start h-12"
				onclick={() => activeMenuTask && handleRestoreTask(activeMenuTask)}
			>
				<Undo2 class="mr-3 h-4 w-4" />
				{$t('task.trash.restore')}
			</Button>
			<Button
				variant="ghost"
				class="w-full justify-start h-12 text-destructive hover:text-destructive"
				onclick={() => activeMenuTask && confirmPermanentDelete(activeMenuTask)}
			>
				<Trash class="mr-3 h-4 w-4" />
				{$t('task.trash.permanently_delete')}
			</Button>
		</div>
	</SheetContent>
</Sheet>

<!-- Confirm permanent delete dialog -->
<ConfirmDialog
	bind:open={confirmPermanentDeleteOpen}
	title={$t('task.trash.confirm_delete_title')}
	description={$t('task.trash.confirm_delete_description', {
		values: { title: taskToDelete?.title || '' }
	})}
	confirmText={$t('common.delete')}
	cancelText={$t('common.cancel')}
	variant="destructive"
	onConfirm={handlePermanentDelete}
/>

<!-- Confirm empty trash dialog -->
<ConfirmDialog
	bind:open={confirmEmptyTrashOpen}
	title={$t('task.trash.confirm_empty_title')}
	description={$t('task.trash.confirm_empty_description', { values: { count: trashTasks.length } })}
	confirmText={$t('task.trash.empty_trash')}
	cancelText={$t('common.cancel')}
	variant="destructive"
	onConfirm={handleEmptyTrash}
/>
