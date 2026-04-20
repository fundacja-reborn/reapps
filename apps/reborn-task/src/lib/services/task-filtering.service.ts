import type { TaskListItem } from '$lib/services/task-title-index.svelte';

export type FilterOption = 'all' | 'starred' | 'overdue' | 'today' | 'upcoming' | 'no_date';

export interface TaskFilters {
	option: FilterOption;
}

/**
 * Checks whether a task matches the given filter criteria.
 */
export function matchesFilters(task: TaskListItem, filters?: TaskFilters): boolean {
	if (!filters || filters.option === 'all') return true;

	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);
	const tomorrowStart = new Date(todayStart);
	tomorrowStart.setDate(tomorrowStart.getDate() + 1);

	switch (filters.option) {
		case 'starred':
			return task.is_starred;
		case 'no_date':
			return !task.due_date;
		case 'overdue': {
			if (!task.due_date || task.is_completed) return false;
			return new Date(task.due_date) < todayStart;
		}
		case 'today': {
			if (!task.due_date) return false;
			const due = new Date(task.due_date);
			return due >= todayStart && due < tomorrowStart;
		}
		case 'upcoming': {
			if (!task.due_date) return false;
			return new Date(task.due_date) >= todayStart;
		}
		default:
			return true;
	}
}

/**
 * Partitions tasks into active and completed, optionally applying filters.
 */
export function partitionTasks(
	tasks: TaskListItem[],
	filters?: TaskFilters
): { activeTasks: TaskListItem[]; completedTasks: TaskListItem[] } {
	const activeTasks: TaskListItem[] = [];
	const completedTasks: TaskListItem[] = [];

	for (const task of tasks) {
		if (!matchesFilters(task, filters)) continue;

		if (task.is_completed) {
			completedTasks.push(task);
		} else {
			activeTasks.push(task);
		}
	}

	return { activeTasks, completedTasks };
}
