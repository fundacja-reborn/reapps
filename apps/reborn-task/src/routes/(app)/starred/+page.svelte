<script lang="ts">
	import {
		Button,
		Skeleton,
		toastStore,
		LoadingSpinner,
		Accordion,
		AccordionItem,
		AccordionContent
	} from '@reborn/ui';
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import { Star, Plus, ChevronRightIcon } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { decryptedStarredTasksSorted } from '$lib/stores/decrypted-tasks.store';
	import { decryptedLists } from '$lib/stores/decrypted-lists.store';
	import { taskCounts } from '$lib/stores/task-counts.store';
	import { taskOperationsService } from '$lib/services/task-operations.service';
	import type { TaskListItem } from '$lib/services/task-title-index.svelte';
	import { TaskItem } from '$lib/components/tasks';
	import { createLogger } from '@reborn/utils';
	import { onDestroy } from 'svelte';

	const logger = createLogger('StarredPage');

	// Get sorted starred tasks from reactive store
	const sortedStarredTasksStore = decryptedStarredTasksSorted();
	let starredTasks = $state<TaskListItem[]>([]);

	// Subscribe to sorted starred tasks
	const unsubscribe = sortedStarredTasksStore.subscribe((tasks) => {
		starredTasks = tasks;
	});

	// Clean up subscription on destroy
	onDestroy(() => {
		unsubscribe();
	});

	// Split into active and completed tasks
	let activeTasks = $derived(starredTasks.filter((task: TaskListItem) => !task.is_completed));

	let completedTasks = $derived(starredTasks.filter((task: TaskListItem) => task.is_completed));

	let starredCount = $derived($taskCounts.starred);
	let isLoading = $state(false);

	// Get list name for a task
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
</script>

<div class="container mx-auto p-6 max-w-4xl">
	{#if isLoading}
		<!-- Loading skeleton -->
		<div class="space-y-4">
			<Skeleton class="h-8 w-64" />
			<Skeleton class="h-4 w-48" />
			<div class="mt-8">
				<Skeleton class="h-32 w-full" />
			</div>
		</div>
	{:else}
		<!-- Starred tasks content -->
		<div class="mt-6">
			{#if activeTasks.length === 0 && completedTasks.length === 0}
				<div class="flex flex-col items-center justify-center py-12 text-center">
					<Star class="h-12 w-12 text-muted-foreground mb-4" />
					<p class="text-lg font-medium mb-2">{$t('taskList.no_starred_tasks')}</p>
					<p class="text-sm text-muted-foreground mb-4">
						{$t('taskList.star_tasks_info')}
					</p>
					<Button variant="outline" onclick={() => window.history.back()}>
						<Plus class="mr-2 h-4 w-4" />
						{$t('taskList.go_to_lists')}
					</Button>
				</div>
			{:else}
				<!-- Active starred tasks -->
				<div class="space-y-2">
					{#if activeTasks.length === 0}
						<div class="text-center py-8 text-muted-foreground">
							<p>{$t('taskList.no_active_tasks')}</p>
						</div>
					{:else}
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
					{/if}
				</div>

				<!-- Completed starred tasks section (if any) -->
				{#if completedTasks.length > 0}
					<div class="mt-6">
						<Accordion type="single">
							<AccordionItem value="completed" class="border-none">
								<AccordionPrimitive.Header class="flex">
									<AccordionPrimitive.Trigger
										class="group flex flex-1 items-center gap-2 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
									>
										<ChevronRightIcon
											class="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90"
										/>
										{$t('taskList.completed_count', { values: { count: completedTasks.length } })}
									</AccordionPrimitive.Trigger>
								</AccordionPrimitive.Header>
								<AccordionContent>
									<div class="space-y-2 pt-2">
										{#each completedTasks as task (task.id)}
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
								</AccordionContent>
							</AccordionItem>
						</Accordion>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
