<script lang="ts">
	import { toastStore } from '@reborn/ui';
	import { ChevronRight } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { upcomingTasks } from '$lib/stores/decrypted-tasks.store';
	import { decryptedLists } from '$lib/stores/decrypted-lists.store';
	import { taskOperationsService } from '$lib/services/task-operations.service';
	import type { TaskListItem } from '$lib/services/task-title-index.svelte';
	import { TaskItem } from '$lib/components/tasks';

	let activeTasks = $derived(($upcomingTasks ?? []).filter((t: TaskListItem) => !t.is_completed));

	function getListName(listId: string): string | null {
		const list = $decryptedLists.find((l) => l.id === listId);
		return list?.name || null;
	}

	async function handleTaskClick(taskId: string) {
		await goto(`/tasks/${taskId}`);
	}

	async function handleTaskComplete(task: TaskListItem, completed: boolean) {
		try {
			await taskOperationsService.toggleCompleted(task.id);
			toastStore.success(completed ? $t('task.success.completed') : $t('task.success.uncompleted'));
		} catch {
			toastStore.error($t('task.errors.update_failed'));
		}
	}

	async function handleToggleStar(task: TaskListItem) {
		try {
			await taskOperationsService.toggleStarred(task.id);
			toastStore.success(
				!task.is_starred ? $t('task.success.starred') : $t('task.success.unstarred')
			);
		} catch {
			toastStore.error($t('task.errors.update_failed'));
		}
	}
</script>

<div class="container mx-auto p-6 max-w-4xl">
	<div class="mt-6">
		{#if activeTasks.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<ChevronRight class="h-12 w-12 text-muted-foreground mb-4" />
				<p class="text-lg font-medium mb-2">
					{$t('task.empty_state', { default: 'Brak zadań' })}
				</p>
				<p class="text-sm text-muted-foreground">
					{$t('taskList.filter.date.upcoming')}
				</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each activeTasks as task (task.id)}
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
