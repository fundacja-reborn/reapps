<!--
  @component
  Full-featured task list for sidebar display (24rem wide).
  Used when icon rail section is a filter (all, starred, overdue, today, upcoming, no_date, trash).
  Displays filtered tasks using TaskItem with checkbox, star, due date, list name.
  Completed tasks hidden in collapsible accordion.
  Click on task → opens task detail in main area.
  Keyboard navigation: Arrow Up/Down to move between tasks.
  Swipe-to-delete on mobile (soft delete with undo for non-trash, permanent delete for trash).
  Trash section: no checkbox/star, flat list, "Empty trash" button.

  Single rendering path (mirrors Notes' NoteList.svelte): the visible list always
  comes from `taskListView` regardless of whether a search query is active. The
  store routes empty/title-only/body-aware paths internally.
-->
<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { ChevronRightIcon, Trash2 } from '@lucide/svelte';
	import type { TaskListItem } from '$lib/services/task-title-index.svelte';
	import { Accordion, AccordionItem, AccordionContent, toastStore } from '@reborn/ui';
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import { activeLists } from '$lib/stores/decrypted-lists.store';
	import { taskOperationsService } from '$lib/services/task-operations.service';
	import { trashManagementService } from '$lib/services/trash-management.service';
	import { t } from '$lib/stores/i18n.store';
	import { sessionExpired } from '$lib/stores/session-expired.store';
	import { isInitialSync } from '$lib/stores/sync-status.store';
	import { createLogger } from '@reborn/utils';
	import { TaskItem, TaskSortButton } from '$lib/components/tasks';
	import { DeleteTaskDialog } from '$lib/components/tasks/dialogs';
	import { ConfirmDialog } from '$lib/components/shared/dialogs';
	import SwipeableItem from '$lib/components/ui/SwipeableItem.svelte';
	import QuickAddTask from '$lib/components/tasks/QuickAddTask.svelte';
	import type { Section } from '../IconNav.svelte';
	import { taskListView, type ListViewSection } from '$lib/stores/task-list-view.store';
	import SidebarSearchBar from './SidebarSearchBar.svelte';

	const logger = createLogger('SidebarTaskList');

	const PAGE_SIZE = 50;

	/** Whether this is a multi-list view (shows list names on task items) */
	const MULTI_LIST_SECTIONS: Section[] = [
		'all',
		'starred',
		'overdue',
		'today',
		'upcoming',
		'no_date'
	];

	let {
		section = 'all',
		activeTaskId = null,
		autoFocusSearch = false,
		hideQuickAdd = false,
		onTaskSelect
	}: {
		section: Exclude<Section, 'lists'>;
		activeTaskId?: string | null;
		autoFocusSearch?: boolean;
		hideQuickAdd?: boolean;
		onTaskSelect: (taskId: string) => void;
	} = $props();

	// ── Search state ────────────────────────────────────────────────
	// Local component state. Sync into the store via $effect — the store is the
	// brain that decides title-only vs body-aware path.
	let searchInput = $state('');
	let searchInDescription = $state(false);
	let searchInputEl = $state<HTMLInputElement | null>(null);

	// Push the active section to the store on prop change. The store's
	// `setSection` is idempotent — no-op when section is unchanged.
	$effect(() => {
		taskListView.setSection(section as ListViewSection);
	});

	// Reset search whenever the section changes — analogous to the equivalent
	// effect in NoteList.svelte. Empty input + toggle off + refresh.
	$effect(() => {
		void section;
		untrack(() => {
			searchInput = '';
			searchInDescription = false;
			taskListView.setSearch('');
			taskListView.setSearchInDescription(false);
		});
	});

	// Sync local input into the store. The store routes empty / fast / AST /
	// body-aware paths in `refresh()`; no local debounce needed (sync title-only
	// is instant; body-aware fork cancels itself via contentSearchVersion).
	$effect(() => {
		taskListView.setSearch(searchInput);
	});

	$effect(() => {
		taskListView.setSearchInDescription(searchInDescription);
	});

	$effect(() => {
		if (autoFocusSearch && searchInputEl) {
			requestAnimationFrame(() => searchInputEl?.focus());
		}
	});

	// `/` keyboard shortcut (handled in (app)/+layout.svelte) → focus this input.
	onMount(() => {
		const handler = () => searchInputEl?.focus();
		window.addEventListener('focus-search', handler);
		return () => window.removeEventListener('focus-search', handler);
	});

	// ── Visible tasks (single source of truth) ──────────────────────
	const visibleTasks = $derived($taskListView);

	// ── Infinite scroll ─────────────────────────────────────────────
	let visibleCount = $state(PAGE_SIZE);
	let sentinelEl = $state<HTMLDivElement | null>(null);
	let observer: IntersectionObserver | undefined;
	let listContainer = $state<HTMLElement | null>(null);

	// Reset visible count when section or search changes.
	$effect(() => {
		void section;
		void searchInput;
		visibleCount = PAGE_SIZE;
	});

	const activeTasks = $derived(visibleTasks.filter((t) => !t.is_completed));
	const completedTasks = $derived(visibleTasks.filter((t) => t.is_completed));
	const visibleActiveTasks = $derived(activeTasks.slice(0, visibleCount));
	const hasMore = $derived(visibleCount < activeTasks.length);
	const showListName = $derived(MULTI_LIST_SECTIONS.includes(section));

	// Auto-expand the "Completed" accordion when the search yields matches only
	// in the completed bucket. Otherwise the user sees "(0)" in the active list
	// header next to a collapsed accordion and assumes there are no results.
	// Reset only on query changes so a manual collapse on the same query sticks.
	let completedAccordionValue = $state('');
	let lastAutoExpandQuery = '';
	$effect(() => {
		const currentSearch = searchInput;
		if (currentSearch === lastAutoExpandQuery) return;
		lastAutoExpandQuery = currentSearch;
		untrack(() => {
			completedAccordionValue =
				currentSearch && activeTasks.length === 0 && completedTasks.length > 0
					? 'completed'
					: '';
		});
	});

	function loadMore() {
		if (visibleCount < activeTasks.length) {
			visibleCount += PAGE_SIZE;
		}
	}

	onMount(() => {
		observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) loadMore();
			},
			{ rootMargin: '200px' }
		);
		if (sentinelEl) observer.observe(sentinelEl);
	});

	$effect(() => {
		if (sentinelEl && observer) {
			observer.observe(sentinelEl);
			return () => observer?.unobserve(sentinelEl!);
		}
	});

	onDestroy(() => observer?.disconnect());

	// ── Helpers ─────────────────────────────────────────────────────
	function getListName(listId: string): string | null {
		const list = $activeLists.find((l) => l.id === listId);
		return list?.name ?? null;
	}

	function getSectionTitle(s: typeof section): string {
		switch (s) {
			case 'all':
				return $t('taskList.filter.all');
			case 'starred':
				return $t('taskList.filter.starred_only');
			case 'overdue':
				return $t('taskList.filter.date.overdue');
			case 'today':
				return $t('taskList.filter.date.today');
			case 'upcoming':
				return $t('taskList.filter.date.upcoming');
			case 'no_date':
				return $t('taskList.filter.date.no_date');
			case 'trash':
				return $t('task.sidebar.trash');
			default:
				return s satisfies never;
		}
	}

	// ── Trash state ─────────────────────────────────────────────────
	const isTrash = $derived(section === 'trash');
	const trashTaskCount = $derived(visibleTasks.length);

	// Swipe delete dialog state (non-trash sections)
	let deleteDialogOpen = $state(false);
	let taskToDelete = $state<TaskListItem | null>(null);

	// Empty trash dialog state
	let confirmEmptyTrashOpen = $state(false);

	// Move completed to trash dialog state
	let moveCompletedToTrashOpen = $state(false);

	// ── Task actions ────────────────────────────────────────────────
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

	// ── Swipe delete (non-trash): soft delete with dialog + undo ──
	function handleSwipeDelete(task: TaskListItem) {
		taskToDelete = task;
		deleteDialogOpen = true;
	}

	async function confirmDelete(option?: 'this_only' | 'future') {
		if (!taskToDelete) return;

		try {
			if (taskToDelete.parent_task_id && option) {
				await taskOperationsService.deleteRecurringInstance(taskToDelete.id, option);
			} else {
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

	// ── Trash: permanent delete via swipe (no dialog) ───────────────
	async function handlePermanentSwipeDelete(task: TaskListItem) {
		try {
			await trashManagementService.permanentlyDeleteTask(task.id);
			toastStore.success($t('task.trash.permanently_deleted'));
		} catch (error: unknown) {
			logger.error('Failed to permanently delete task:', error);
			toastStore.error($t('task.trash.delete_failed'));
		}
	}

	// ── Trash: empty all ────────────────────────────────────────────
	async function handleEmptyTrash() {
		try {
			await trashManagementService.emptyTrash();
			toastStore.success($t('task.trash.emptied'));
			confirmEmptyTrashOpen = false;
		} catch (error: unknown) {
			logger.error('Failed to empty trash:', error);
			toastStore.error($t('task.trash.empty_failed'));
		}
	}

	// ── Move completed to trash ────────────────────────────────────
	async function handleMoveCompletedToTrash() {
		if (completedTasks.length === 0) return;
		try {
			const taskIds = completedTasks.map((t) => t.id);
			const count = await taskOperationsService.moveCompletedToTrash(taskIds);
			toastStore.success($t('taskList.completed.move_to_trash_success', { values: { count } }));
		} catch (error: unknown) {
			logger.error('Failed to move completed tasks to trash:', error);
			toastStore.error($t('taskList.completed.move_to_trash_error'));
		} finally {
			moveCompletedToTrashOpen = false;
		}
	}

	// ── Keyboard navigation ─────────────────────────────────────────
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

	let quickAddRef = $state<QuickAddTask | undefined>(undefined);

	export function focusQuickAdd() {
		quickAddRef?.focus();
	}
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex h-10 shrink-0 items-center gap-1 px-5">
		<span class="min-w-0 flex-1 truncate text-sm font-normal"
			>{getSectionTitle(section)} ({isTrash ? trashTaskCount : activeTasks.length})</span
		>
		{#if isTrash && trashTaskCount > 0}
			<button
				type="button"
				onclick={() => (confirmEmptyTrashOpen = true)}
				class="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-destructive transition-colors hover:bg-destructive/10"
			>
				<Trash2 class="h-3.5 w-3.5" />
				{$t('task.trash.empty_trash')}
			</button>
		{/if}
		<TaskSortButton listId={section} />
	</div>

	<!-- Search bar -->
	<SidebarSearchBar bind:searchInput bind:searchInDescription bind:searchInputEl />

	<!-- Quick add task (hidden in trash, overdue, when hideQuickAdd is set, or when actively searching) -->
	{#if !isTrash && section !== 'overdue' && !hideQuickAdd && !searchInput}
		<div class="shrink-0 px-3 pb-2">
			<QuickAddTask bind:this={quickAddRef} showListSelect {section} class="text-xs" />
		</div>
	{/if}

	<!-- Task list (single rendering path — store decides what's visible) -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="flex-1 overflow-y-auto px-3"
		bind:this={listContainer}
		onkeydown={handleListKeyDown}
		role="list"
	>
		{#if (isTrash ? visibleTasks.length : activeTasks.length + completedTasks.length) === 0}
			<div class="px-4 py-8 text-center">
				{#if searchInput}
					<p class="text-sm text-muted-foreground">
						{$t('taskList.no_match', { values: { query: searchInput } })}
					</p>
					<button
						type="button"
						onclick={() => {
							searchInput = '';
							searchInDescription = false;
						}}
						class="mt-2 text-xs text-primary underline-offset-4 hover:underline"
					>
						{$t('common.clear_search', { default: 'Wyczyść wyszukiwanie' })}
					</button>
				{:else if $sessionExpired}
					<p class="text-sm text-muted-foreground">
						{$t('auth.session.empty_no_data')}
					</p>
				{:else if $isInitialSync}
					<p class="text-sm text-muted-foreground">
						{$t('sync.initial.title')}
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">
						{$t('task.empty_state', { default: 'Brak zadań' })}
					</p>
				{/if}
			</div>
		{:else if isTrash}
			<!-- Trash: flat list, no checkbox/star, swipe = permanent delete -->
			<div class="flex flex-col gap-2 py-1" role="listitem">
				{#each visibleTasks as task (task.id)}
					<SwipeableItem onDelete={() => handlePermanentSwipeDelete(task)} deleteButtonWidth={64}>
						<TaskItem
							{task}
							listName={getListName(task.task_list_id)}
							showListName={true}
							onClick={() => onTaskSelect(task.id)}
						/>
					</SwipeableItem>
				{/each}
			</div>
		{:else}
			<!-- Active tasks -->
			<div class="flex flex-col gap-2 py-1" role="listitem">
				{#each visibleActiveTasks as task (task.id)}
					<SwipeableItem onDelete={() => handleSwipeDelete(task)} deleteButtonWidth={64}>
						<TaskItem
							{task}
							listName={showListName ? getListName(task.task_list_id) : null}
							{showListName}
							onClick={() => onTaskSelect(task.id)}
							onComplete={(completed) => handleTaskComplete(task, completed)}
							onToggleStar={() => handleToggleStar(task)}
						/>
					</SwipeableItem>
				{/each}
			</div>

			{#if hasMore}
				<div bind:this={sentinelEl} class="h-8 w-full" aria-hidden="true"></div>
			{/if}

			<!-- Completed tasks accordion -->
			{#if completedTasks.length > 0}
				<div class="mt-2 pb-2">
					<Accordion type="single" bind:value={completedAccordionValue}>
						<AccordionItem value="completed" class="group border-none">
							<AccordionPrimitive.Header class="flex items-center">
								<AccordionPrimitive.Trigger
									class="group flex flex-1 items-center gap-2 py-2 px-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
								>
									<ChevronRightIcon
										class="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90"
									/>
									{$t('taskList.completed_count', { values: { count: completedTasks.length } })}
								</AccordionPrimitive.Trigger>
								<button
									type="button"
									class="ml-auto p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hidden group-data-[state=open]:flex cursor-pointer"
									title={$t('taskList.completed.move_to_trash')}
									onclick={(e) => {
										e.stopPropagation();
										moveCompletedToTrashOpen = true;
									}}
								>
									<Trash2 class="h-3.5 w-3.5" />
								</button>
							</AccordionPrimitive.Header>
							<AccordionContent>
								<div class="flex flex-col gap-2 pt-1">
									{#each completedTasks as task (task.id)}
										<TaskItem
											{task}
											listName={showListName ? getListName(task.task_list_id) : null}
											{showListName}
											onClick={() => onTaskSelect(task.id)}
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

<!-- Delete Task Dialog (non-trash swipe delete) -->
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

<!-- Confirm empty trash dialog -->
<ConfirmDialog
	bind:open={confirmEmptyTrashOpen}
	title={$t('task.trash.confirm_empty_title')}
	description={$t('task.trash.confirm_empty_description', { values: { count: trashTaskCount } })}
	confirmText={$t('task.trash.empty_trash')}
	cancelText={$t('common.cancel')}
	variant="destructive"
	onConfirm={handleEmptyTrash}
/>

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
