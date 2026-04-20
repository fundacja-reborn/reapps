<script lang="ts">
	import { CheckCheck, Plus, Trash2 } from '@lucide/svelte';
	import {
		Button,
		Skeleton,
		toastStore,
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { decryptedAllCompletedTasksSorted } from '$lib/stores/decrypted-tasks.store';
	import { decryptedLists } from '$lib/stores/decrypted-lists.store';
	import { taskOperationsService } from '$lib/services/task-operations.service';
	import type { TaskListItem } from '$lib/services/task-title-index.svelte';
	import { TaskItem } from '$lib/components/tasks';
	import { ConfirmDialog } from '$lib/components/shared/dialogs';
	import { createLogger } from '@reborn/utils';
	import { onDestroy } from 'svelte';

	const logger = createLogger('CompletedPage');

	// Get all completed tasks from reactive store
	const completedTasksStore = decryptedAllCompletedTasksSorted();
	let allCompletedTasks = $state<TaskListItem[]>([]);

	const unsubscribe = completedTasksStore.subscribe((tasks) => {
		allCompletedTasks = tasks;
	});

	onDestroy(() => {
		unsubscribe();
	});

	// Filter by list
	let selectedListId = $state<string>('all');
	let moveToTrashOpen = $state(false);

	// Get list name for a task
	function getListName(listId: string): string | null {
		const list = $decryptedLists.find((l) => l.id === listId);
		return list?.name || null;
	}

	// Filtered tasks
	let filteredTasks = $derived(
		selectedListId === 'all'
			? allCompletedTasks
			: allCompletedTasks.filter((task) => task.task_list_id === selectedListId)
	);

	async function handleTaskClick(taskId: string) {
		await goto(`/tasks/${taskId}`);
	}

	async function handleTaskComplete(task: TaskListItem, completed: boolean) {
		try {
			await taskOperationsService.toggleCompleted(task.id);
			toastStore.success(completed ? $t('task.success.completed') : $t('task.success.uncompleted'));
		} catch (error: unknown) {
			logger.error('Failed to update task completion:', error);
			toastStore.error($t('task.errors.update_failed'));
			throw error;
		}
	}

	async function handleToggleStar(task: TaskListItem) {
		try {
			await taskOperationsService.toggleStarred(task.id);
			toastStore.success(
				!task.is_starred ? $t('task.success.starred') : $t('task.success.unstarred')
			);
		} catch (error: unknown) {
			logger.error('Failed to toggle star:', error);
			toastStore.error($t('task.errors.update_failed'));
			throw error;
		}
	}

	async function handleMoveCompletedToTrash() {
		if (filteredTasks.length === 0) return;
		try {
			const taskIds = filteredTasks.map((t) => t.id);
			const count = await taskOperationsService.moveCompletedToTrash(taskIds);
			toastStore.success($t('taskList.completed.move_to_trash_success', { values: { count } }));
		} catch (error: unknown) {
			logger.error('Failed to move completed tasks to trash:', error);
			toastStore.error($t('taskList.completed.move_to_trash_error'));
		} finally {
			moveToTrashOpen = false;
		}
	}
</script>

<div class="container mx-auto p-6 max-w-4xl">
	<!-- Filter bar — only when there's more than one list -->
	{#if $decryptedLists.length > 1}
		<div class="mb-4 flex items-center gap-2">
			<span class="text-sm text-muted-foreground shrink-0"
				>{$t('taskList.completed.filter_by_list')}:</span
			>
			<Select type="single" bind:value={selectedListId}>
				<SelectTrigger class="h-8 w-auto min-w-35 text-sm">
					{selectedListId === 'all'
						? $t('taskList.completed.all_lists')
						: (getListName(selectedListId) ?? $t('taskList.completed.all_lists'))}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">{$t('taskList.completed.all_lists')}</SelectItem>
					{#each $decryptedLists as list (list.id)}
						<SelectItem value={list.id}>{list.name}</SelectItem>
					{/each}
				</SelectContent>
			</Select>
			{#if filteredTasks.length > 0}
				<Button
					variant="outline"
					size="sm"
					class="ml-auto text-muted-foreground hover:text-destructive"
					onclick={() => (moveToTrashOpen = true)}
				>
					<Trash2 class="mr-1.5 h-4 w-4" />
					{$t('taskList.completed.move_to_trash')}
				</Button>
			{/if}
		</div>
	{:else if filteredTasks.length > 0}
		<div class="mb-4 flex justify-end">
			<Button
				variant="outline"
				size="sm"
				class="text-muted-foreground hover:text-destructive"
				onclick={() => (moveToTrashOpen = true)}
			>
				<Trash2 class="mr-1.5 h-4 w-4" />
				{$t('taskList.completed.move_to_trash')}
			</Button>
		</div>
	{/if}

	<!-- Completed tasks content -->
	<div class="mt-2">
		{#if filteredTasks.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<CheckCheck class="h-12 w-12 text-muted-foreground mb-4" />
				<p class="text-lg font-medium mb-2">{$t('taskList.completed.empty')}</p>
				<p class="text-sm text-muted-foreground mb-4">
					{$t('taskList.completed.empty_info')}
				</p>
				<Button variant="outline" onclick={() => window.history.back()}>
					<Plus class="mr-2 h-4 w-4" />
					{$t('taskList.go_to_lists')}
				</Button>
			</div>
		{:else}
			<div class="space-y-2">
				{#each filteredTasks as task (task.id)}
					<TaskItem
						{task}
						listName={getListName(task.task_list_id)}
						showListName={true}
						onClick={() => handleTaskClick(task.id)}
						onComplete={(completed) => handleTaskComplete(task, completed)}
						onToggleStar={() => handleToggleStar(task)}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- Move Completed to Trash Dialog -->
<ConfirmDialog
	bind:open={moveToTrashOpen}
	title={$t('taskList.completed.move_to_trash_confirm_title')}
	description={$t('taskList.completed.move_to_trash_confirm', {
		values: { count: filteredTasks.length }
	}) +
		' ' +
		$t('taskList.completed.move_to_trash_description')}
	confirmText={$t('taskList.completed.move_to_trash')}
	variant="destructive"
	onConfirm={handleMoveCompletedToTrash}
/>
