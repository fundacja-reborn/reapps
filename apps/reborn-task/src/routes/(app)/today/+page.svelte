<script lang="ts">
	import { toastStore } from '@reborn/ui';
	import { Accordion, AccordionItem, AccordionContent } from '@reborn/ui';
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import { Sun, ChevronRightIcon } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { todayTasks } from '$lib/stores/decrypted-tasks.store';
	import { decryptedLists } from '$lib/stores/decrypted-lists.store';
	import { taskOperationsService } from '$lib/services/task-operations.service';
	import type { TaskListItem } from '$lib/services/task-title-index.svelte';
	import { TaskItem } from '$lib/components/tasks';

	let allTodayTasks = $derived($todayTasks ?? []);
	let activeTasks = $derived(allTodayTasks.filter((task: TaskListItem) => !task.is_completed));
	let completedTasks = $derived(allTodayTasks.filter((task: TaskListItem) => task.is_completed));

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
		{#if activeTasks.length === 0 && completedTasks.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<Sun class="h-12 w-12 text-muted-foreground mb-4" />
				<p class="text-lg font-medium mb-2">
					{$t('task.empty_state', { default: 'Brak zadań' })}
				</p>
				<p class="text-sm text-muted-foreground">
					{$t('taskList.filter.date.today')}
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
</div>
