/**
 * Decrypted Tasks Store
 *
 * This store provides reactive views of task data for UI components.
 * It reads synchronously from the in-memory TaskIndex — NO decryption happens here.
 *
 * Data flow:
 * IndexedDB (encrypted) → TaskIndex (title-only decrypt, RAM cache) → THIS STORE → UI Components
 *
 * Full decryption (description, recurrence_rule) happens on-demand in task-detail.service.ts.
 */

import { writable, derived, get, type Readable } from 'svelte/store';
import {
	taskIndex,
	type TaskListItem,
	type TaskSortField
} from '$lib/services/task-title-index.svelte';
import { taskSortStore, type TaskSortOption } from '$lib/stores/task-sort.store';

// ── Bridge: TaskIndex ($state) → Svelte stores (writable) ───────

const _trigger = writable(0);
taskIndex.onChange(() => _trigger.update((v) => v + 1));

// ── Sort utility (preserved for SidebarTaskList and other consumers) ──

function mapSortOption(option: TaskSortOption): TaskSortField {
	switch (option) {
		case 'alphabetical':
			return 'alphabetical';
		case 'due_date':
			return 'due_date';
		case 'created_date':
			return 'created_date';
		case 'starred':
			return 'starred';
		default:
			return 'position';
	}
}

/**
 * Sort tasks based on the selected sort option.
 * Kept as a standalone utility for consumers that sort manually (e.g. SidebarTaskList).
 */
export function sortTasks(
	tasks: TaskListItem[],
	sortOption: TaskSortOption,
	direction: 'asc' | 'desc' = 'asc'
): TaskListItem[] {
	const sorted = [...tasks];

	switch (sortOption) {
		case 'alphabetical':
			sorted.sort((a, b) => {
				const compare = a.title.localeCompare(b.title, 'pl');
				return direction === 'asc' ? compare : -compare;
			});
			break;

		case 'due_date':
			sorted.sort((a, b) => {
				if (a.is_completed !== b.is_completed) {
					return a.is_completed ? 1 : -1;
				}
				if (!a.due_date && !b.due_date) return a.position - b.position;
				if (!a.due_date) return 1;
				if (!b.due_date) return -1;
				const dateA = new Date(a.due_date).getTime();
				const dateB = new Date(b.due_date).getTime();
				return direction === 'asc' ? dateA - dateB : dateB - dateA;
			});
			break;

		case 'created_date':
			sorted.sort((a, b) => {
				const dateA = new Date(a.created_at).getTime();
				const dateB = new Date(b.created_at).getTime();
				return direction === 'asc' ? dateA - dateB : dateB - dateA;
			});
			break;

		case 'starred':
			sorted.sort((a, b) => {
				if (a.is_starred === b.is_starred) {
					return a.position - b.position;
				}
				return a.is_starred ? -1 : 1;
			});
			break;

		default:
			break;
	}

	return sorted;
}

// ── Per-list store ──────────────────────────────────────────────

/**
 * Reactive store with tasks for a specific list (sorted by user preference).
 */
export function decryptedTasksByList(listId: string): Readable<TaskListItem[]> {
	return derived([_trigger, taskSortStore], () => {
		const { option, direction } = taskSortStore.getListSort(listId);
		return taskIndex.getFiltered({
			listId,
			sortBy: mapSortOption(option),
			sortDirection: direction
		}).items;
	});
}

// ── Global stores ───────────────────────────────────────────────

/**
 * All active (non-deleted, non-template) tasks.
 * Default sort: incomplete first → starred → position.
 */
export const tasks: Readable<TaskListItem[]> = derived(_trigger, () => {
	return taskIndex.getFiltered({ sortBy: 'position' }).items;
});

export const activeTasks = derived(tasks, ($tasks) => $tasks.filter((task) => !task.is_completed));
export const completedTasks = derived(tasks, ($tasks) =>
	$tasks.filter((task) => task.is_completed)
);
export const starredTasks = derived(tasks, ($tasks) =>
	$tasks.filter((task) => task.is_starred && !task.is_completed)
);
export function tasksByList(listId: string) {
	return derived(tasks, ($tasks) => $tasks.filter((task) => task.task_list_id === listId));
}
export const todayTasks: Readable<TaskListItem[]> = derived(
	_trigger,
	() => taskIndex.getFiltered({ section: 'today' }).items
);
export const overdueTasks: Readable<TaskListItem[]> = derived(
	_trigger,
	() => taskIndex.getFiltered({ section: 'overdue' }).items
);
export const upcomingTasks: Readable<TaskListItem[]> = derived(
	_trigger,
	() => taskIndex.getFiltered({ section: 'upcoming' }).items
);
export const noDateTasks: Readable<TaskListItem[]> = derived(
	_trigger,
	() => taskIndex.getFiltered({ section: 'no_date' }).items
);

// ── Helpers ─────────────────────────────────────────────────────

export function getTaskById(taskId: string): TaskListItem | undefined {
	const allTasks = get(tasks);
	return allTasks.find((task) => task.id === taskId);
}

// ── Aliases (backward compat) ───────────────────────────────────

export const decryptedTasks = tasks;
export const decryptedActiveTasks = activeTasks;
export const decryptedCompletedTasks = completedTasks;
export const decryptedStarredTasks = starredTasks;
export const decryptedTodayTasks = todayTasks;
export const decryptedOverdueTasks = overdueTasks;
export const decryptedUpcomingTasks = upcomingTasks;
export const decryptedNoDateTasks = noDateTasks;

// ── Specialized sorted stores ───────────────────────────────────

/**
 * All completed tasks sorted by completion date (newest first).
 * Used by /completed view.
 */
export function decryptedAllCompletedTasksSorted(): Readable<TaskListItem[]> {
	return derived(_trigger, () => {
		const result = taskIndex.getFiltered({ completed: true });
		return [...result.items].sort((a, b) => {
			if (!a.completed_at && !b.completed_at) return 0;
			if (!a.completed_at) return 1;
			if (!b.completed_at) return -1;
			return new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime();
		});
	});
}

/**
 * Starred tasks sorted by user preference.
 * Used by /starred view.
 */
export function decryptedStarredTasksSorted(): Readable<TaskListItem[]> {
	return derived([_trigger, taskSortStore], () => {
		const { option, direction } = taskSortStore.getListSort('starred');
		return taskIndex.getFiltered({
			starred: true,
			sortBy: mapSortOption(option),
			sortDirection: direction
		}).items;
	});
}
