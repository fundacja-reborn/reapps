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
-->
<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { Search, X, ChevronRightIcon, CheckCircle2, Trash2 } from '@lucide/svelte';
	import type { TaskListItem } from '$lib/services/task-title-index.svelte';
	import { Accordion, AccordionItem, AccordionContent, toastStore, cn } from '@reborn/ui';
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import {
		tasks as allDecryptedTasks,
		sortTasks,
		starredTasks,
		todayTasks,
		overdueTasks,
		upcomingTasks,
		noDateTasks
	} from '$lib/stores/decrypted-tasks.store';
	import { taskSortStore } from '$lib/stores/task-sort.store';
	import { decryptedTrashTasks } from '$lib/stores/decrypted-trash.store';
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
	import { evaluate, parseQuery, type SearchEntity } from '@reborn/utils';
	import { buildTaskSearchContext } from '$lib/services/task-search-context';

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

	// ── Search ──────────────────────────────────────────────────────
	let searchInput = $state('');
	let searchInputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (autoFocusSearch && searchInputEl) {
			requestAnimationFrame(() => searchInputEl?.focus());
		}
	});

	// ── Infinite scroll ─────────────────────────────────────────────
	let visibleCount = $state(PAGE_SIZE);
	let sentinelEl = $state<HTMLDivElement | null>(null);
	let observer: IntersectionObserver | undefined;
	let listContainer = $state<HTMLElement | null>(null);

	// Reset search input when section changes
	$effect(() => {
		void section;
		untrack(() => {
			searchInput = '';
		});
	});

	// Reset visible count when section or search changes
	$effect(() => {
		void section;
		void searchInput;
		visibleCount = PAGE_SIZE;
	});

	// ── Filtered tasks ──────────────────────────────────────────────
	// Use per-section stores from decrypted-tasks.store (backed by taskIndex)
	// instead of re-filtering with matchesFilters (duplicate logic).
	const sectionSource = $derived.by(() => {
		switch (section) {
			case 'trash':
				return $decryptedTrashTasks ?? [];
			case 'starred':
				return $starredTasks ?? [];
			case 'today':
				return $todayTasks ?? [];
			case 'overdue':
				return $overdueTasks ?? [];
			case 'upcoming':
				return $upcomingTasks ?? [];
			case 'no_date':
				return $noDateTasks ?? [];
			default:
				return $allDecryptedTasks ?? [];
		}
	});

	const allFilteredTasks = $derived.by(() => {
		let source = sectionSource;

		// Search filter — runs the same operator-aware AST as the global /search box
		// (parser → evaluator from @reborn/utils). Pure freetext degrades to a
		// title substring match because TaskListItem doesn't carry description;
		// `has:link` and description-aware freetext still need the global /search
		// page (decryption pipeline lives in search.service).
		if (searchInput.trim()) {
			const ast = parseQuery(searchInput);
			const ctx = buildTaskSearchContext();
			source = source.filter((task) => evaluate(ast, taskListItemToSearchEntity(task), ctx));
		}

		// Apply sort preferences
		const { option, direction } = $taskSortStore[section] ?? {
			option: 'due_date',
			direction: 'asc'
		};
		source = sortTasks(source, option, direction);

		return source;
	});

	function taskListItemToSearchEntity(task: TaskListItem): SearchEntity {
		return {
			id: task.id,
			title: task.title,
			body: undefined,
			tagIds: [],
			folderId: null,
			listId: task.task_list_id ?? null,
			createdAt: new Date(task.created_at),
			updatedAt: new Date(task.updated_at),
			dueAt: task.due_date ? new Date(task.due_date) : null,
			flags: {
				starred: task.is_starred,
				completed: task.is_completed,
				trashed: !!task.deleted_at
			}
		};
	}

	const activeTasks = $derived(allFilteredTasks.filter((t) => !t.is_completed));
	const completedTasks = $derived(allFilteredTasks.filter((t) => t.is_completed));

	const visibleActiveTasks = $derived(activeTasks.slice(0, visibleCount));
	const hasMore = $derived(visibleCount < activeTasks.length);

	const showListName = $derived(MULTI_LIST_SECTIONS.includes(section));

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

	function clearSearch() {
		searchInput = '';
	}

	// ── Trash state ─────────────────────────────────────────────────
	const isTrash = $derived(section === 'trash');
	const trashTaskCount = $derived(allFilteredTasks.length);

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
	<div class="shrink-0 px-3 pb-2">
		<div class="relative">
			<Search class="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
			<input
				bind:this={searchInputEl}
				type="text"
				placeholder={$t('common.search', { default: 'Szukaj...' })}
				value={searchInput}
				oninput={(e) => {
					searchInput = (e.target as HTMLInputElement).value;
				}}
				class="w-full rounded-md border bg-background py-2 pl-7 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
			/>
			{#if searchInput}
				<button
					type="button"
					onclick={clearSearch}
					class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-foreground"
				>
					<X class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>
	</div>

	<!-- Quick add task (hidden in trash, overdue, and when hideQuickAdd is set) -->
	{#if !isTrash && section !== 'overdue' && !hideQuickAdd}
		<div class="shrink-0 px-3 pb-2">
			<QuickAddTask bind:this={quickAddRef} showListSelect {section} class="text-xs" />
		</div>
	{/if}

	<!-- Task list -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="flex-1 overflow-y-auto px-3"
		bind:this={listContainer}
		onkeydown={handleListKeyDown}
		role="list"
	>
		{#if (isTrash ? allFilteredTasks.length : activeTasks.length + completedTasks.length) === 0}
			<div class="px-4 py-8 text-center">
				{#if searchInput}
					<p class="text-sm text-muted-foreground">
						{$t('taskList.no_match', { values: { query: searchInput } })}
					</p>
					<button
						type="button"
						onclick={clearSearch}
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
				{#each allFilteredTasks as task (task.id)}
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
					<Accordion type="single">
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
