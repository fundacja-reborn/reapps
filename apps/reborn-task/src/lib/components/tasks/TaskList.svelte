<script lang="ts">
	import { TaskItem } from './index';
	import SwipeableItem from '../ui/SwipeableItem.svelte';
	import {
		toastStore,
		LoadingSpinner,
		Accordion,
		AccordionItem,
		AccordionContent
	} from '@reborn/ui';
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import { ChevronRightIcon, Trash2 } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { sessionExpired } from '$lib/stores/session-expired.store';
	import { goto } from '$lib/utils/navigation';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { ListDecrypted } from '@reborn/types';
	import type { TaskListItem } from '$lib/services/task-title-index.svelte';
	import { createLogger } from '@reborn/utils';
	import { decryptedTasksByList } from '$lib/stores/decrypted-tasks.store';
	import { listById } from '$lib/stores/decrypted-lists.store';
	import { taskOperationsService } from '$lib/services/task-operations.service';
	import { matchesFilters, type TaskFilters } from '$lib/services/task-filtering.service';
	import { tick } from 'svelte';
	import { DeleteTaskDialog } from '../tasks/dialogs';
	import { ConfirmDialog } from '$lib/components/shared/dialogs';
	import QuickAddTask from './QuickAddTask.svelte';

	const logger = createLogger('TaskList');

	let {
		listId,
		filters = undefined,
		class: className = ''
	} = $props<{
		listId: string;
		filters?: TaskFilters;
		class?: string;
	}>();

	let isLoading = $state(true);
	let lastListId = $state(untrack(() => listId));
	let hasLoadedInitially = $state(false);

	// Progressive rendering
	const CHUNK_SIZE = 50;
	let visibleCount = $state(CHUNK_SIZE);
	let sentinel = $state<HTMLElement | undefined>(undefined);
	let listContainer = $state<HTMLElement | undefined>(undefined);

	// Load more tasks as sentinel enters viewport
	$effect(() => {
		if (!sentinel || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0]?.isIntersecting) {
				visibleCount = Math.min(visibleCount + CHUNK_SIZE, activeTasks.length);
			}
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	});

	function handleListKeyDown(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const container = listContainer;
		if (!container) return;
		const items = Array.from(container.querySelectorAll<HTMLElement>('[data-task-item]'));
		if (!items.length) return;
		const idx = items.indexOf(document.activeElement as HTMLElement);
		e.preventDefault();
		if (e.key === 'ArrowDown') {
			(idx < items.length - 1 ? items[idx + 1] : items[0])?.focus();
		} else {
			(idx > 0 ? items[idx - 1] : items[items.length - 1])?.focus();
		}
	}

	// Dialog states
	let deleteDialogOpen = $state(false);
	let taskToDelete = $state<TaskListItem | null>(null);
	let moveCompletedToTrashOpen = $state(false);
	let isMovingToTrash = $state(false);

	// Get tasks for this list from decrypted store (optymalnie)
	const tasksStore = decryptedTasksByList(untrack(() => listId));
	let tasks = $state<TaskListItem[]>([]);
	const unsubscribe = tasksStore.subscribe((val: TaskListItem[]) => {
		tasks = val;
		isLoading = false;
	});

	// Get list name from decrypted store
	const listStore = listById(untrack(() => listId));
	let currentList = $state<ListDecrypted | null>(null);
	const unsubscribeList = listStore.subscribe((val: ListDecrypted | null) => {
		currentList = val;
	});

	onDestroy(() => {
		unsubscribe();
		unsubscribeList();
	});

	// Podział zadań na aktywne i wykonane (z uwzględnieniem filtrów)
	let activeTasks = $derived(
		tasks.filter((task) => !task.is_completed && matchesFilters(task, filters))
	);
	let completedTasks = $derived(
		tasks.filter((task) => task.is_completed && matchesFilters(task, filters))
	);

	let visibleActiveTasks = $derived(activeTasks.slice(0, visibleCount));
	let hasMoreTasks = $derived(visibleCount < activeTasks.length);

	// Load tasks when component mounts or listId changes
	$effect(() => {
		// Use untrack to avoid reactive loops
		untrack(() => {
			if (listId && listId !== lastListId) {
				lastListId = listId;
				hasLoadedInitially = false;
				// Tasks are already reactive from decrypted store
				isLoading = false;
			} else if (!hasLoadedInitially && listId) {
				hasLoadedInitially = true;
				// Tasks are already reactive from decrypted store
				isLoading = false;
			}
		});
	});

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

	async function handleTaskDelete(taskId: string) {
		const task = tasks.find((t) => t.id === taskId);
		if (task) {
			taskToDelete = task;
			deleteDialogOpen = true;
		}
	}

	async function confirmDelete(option?: 'this_only' | 'future') {
		if (!taskToDelete) return;

		try {
			// Check if this is a recurring instance
			if (taskToDelete.parent_task_id && option) {
				await taskOperationsService.deleteRecurringInstance(taskToDelete.id, option);
			} else {
				// Regular delete with undo
				const undoFn = await taskOperationsService.deleteTaskWithUndo(taskToDelete.id);

				toastStore.custom({
					title: $t('task.undo.message'),
					duration: 5000,
					action: {
						label: $t('task.undo.action'),
						onClick: async () => {
							try {
								await undoFn();
								toastStore.success($t('task.success.restored'));
							} catch (error: unknown) {
								logger.error('Failed to restore task:', error);
								toastStore.error($t('task.errors.restore_failed'));
							}
						}
					}
				});
			}
		} catch (error: unknown) {
			logger.error('Failed to delete task:', error);
			toastStore.error($t('task.errors.delete_failed'));
		} finally {
			deleteDialogOpen = false;
			taskToDelete = null;
		}
	}

	async function handleMoveCompletedToTrash() {
		if (completedTasks.length === 0) return;
		isMovingToTrash = true;
		try {
			const taskIds = completedTasks.map((t) => t.id);
			const count = await taskOperationsService.moveCompletedToTrash(taskIds);
			toastStore.success($t('taskList.completed.move_to_trash_success', { values: { count } }));
		} catch (error: unknown) {
			logger.error('Failed to move completed tasks to trash:', error);
			toastStore.error($t('taskList.completed.move_to_trash_error'));
		} finally {
			isMovingToTrash = false;
			moveCompletedToTrashOpen = false;
		}
	}

	// Public method to refresh tasks (can be called from parent)
	export async function refresh() {
		// With reactive stores, refresh just means ensuring we have latest data
		// The decrypted store will automatically update when underlying data changes
		logger.info('Refresh requested for list:', listId);
	}

	let quickAddRef = $state<QuickAddTask | undefined>(undefined);

	export function focusQuickAdd() {
		quickAddRef?.focus();
	}

	// Listen for desktop focus-quick-add event (dispatched from +layout.svelte handleNewTask)
	onMount(() => {
		const handler = () => quickAddRef?.focus();
		window.addEventListener('focus-quick-add', handler);
		return () => window.removeEventListener('focus-quick-add', handler);
	});
</script>

<div class={className} aria-busy={isLoading}>
	{#if isLoading}
		<div class="flex justify-center py-8">
			<LoadingSpinner />
		</div>
	{:else}
		{#if tasks.length === 0}
		<div class="text-center py-12 text-muted-foreground">
			{#if $sessionExpired}
				<p>{$t('auth.session.empty_no_data')}</p>
			{:else}
				<p>{$t('task.empty_list')}</p>
			{/if}
		</div>
		{:else}
		<!-- Lista zadań aktywnych -->
		{#if activeTasks.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<p>{$t('taskList.no_active_tasks')}</p>
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="space-y-2"
				role="list"
				aria-label={$t('tasks.aria.active_tasks', { default: 'Aktywne zadania' })}
				bind:this={listContainer}
				onkeydown={handleListKeyDown}
			>
				{#each visibleActiveTasks as task (task.id)}
					<div role="listitem" transition:fade={{ duration: 250 }}>
						<SwipeableItem onDelete={() => handleTaskDelete(task.id)}>
							<TaskItem
								{task}
								listName={currentList?.name}
								onClick={() => handleTaskClick(task.id)}
								onComplete={(completed) => handleTaskComplete(task, completed)}
								onToggleStar={() => handleToggleStar(task)}
							/>
						</SwipeableItem>
					</div>
				{/each}
				{#if hasMoreTasks}
					<div bind:this={sentinel} class="h-1" aria-hidden="true"></div>
				{/if}
			</div>
		{/if}

		{/if}

		<!-- Quick add task -->
		<div class="mt-3">
			<QuickAddTask bind:this={quickAddRef} {listId} />
		</div>

		<!-- Sekcja zadań wykonanych (jeśli istnieją) -->
		{#if tasks.length > 0}
		{#if completedTasks.length > 0}
			<div class="mt-6">
				<Accordion type="single">
					<AccordionItem value="completed" class="group border-none">
						<AccordionPrimitive.Header class="flex items-center">
							<AccordionPrimitive.Trigger
								class="group flex flex-1 items-center gap-2 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
							>
								<ChevronRightIcon
									class="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90"
								/>
								{$t('taskList.completed_count', { values: { count: completedTasks.length } })}
							</AccordionPrimitive.Trigger>
							<button
								type="button"
								class="ml-auto p-2 text-muted-foreground hover:text-destructive transition-colors rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hidden group-data-[state=open]:flex cursor-pointer"
								title={$t('taskList.completed.move_to_trash')}
								onclick={(e) => {
									e.stopPropagation();
									moveCompletedToTrashOpen = true;
								}}
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</AccordionPrimitive.Header>
						<AccordionContent>
							<div class="space-y-2 pt-2">
								{#each completedTasks as task (task.id)}
									<div transition:fade={{ duration: 250 }}>
										<SwipeableItem onDelete={() => handleTaskDelete(task.id)}>
											<TaskItem
												{task}
												listName={currentList?.name}
												onClick={() => handleTaskClick(task.id)}
												onComplete={(completed) => handleTaskComplete(task, completed)}
												onToggleStar={() => handleToggleStar(task)}
											/>
										</SwipeableItem>
									</div>
								{/each}
							</div>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			</div>
		{/if}
		{/if}
	{/if}
</div>

<!-- Delete Task Dialog -->
{#if taskToDelete}
	<DeleteTaskDialog
		bind:open={deleteDialogOpen}
		taskTitle={taskToDelete.title}
		isRecurringInstance={!!taskToDelete.parent_task_id}
		onConfirm={confirmDelete}
		onClose={() => {
			deleteDialogOpen = false;
			taskToDelete = null;
		}}
	/>
{/if}

<!-- Move Completed to Trash Dialog -->
<ConfirmDialog
	bind:open={moveCompletedToTrashOpen}
	title={$t('taskList.completed.move_to_trash_confirm_title')}
	description={$t('taskList.completed.move_to_trash_confirm', {
		values: { count: completedTasks.length }
	}) +
		' ' +
		$t('taskList.completed.move_to_trash_description')}
	confirmText={$t('taskList.completed.move_to_trash')}
	variant="destructive"
	onConfirm={handleMoveCompletedToTrash}
/>
