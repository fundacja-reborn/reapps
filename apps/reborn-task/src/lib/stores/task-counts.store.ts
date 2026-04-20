import { writable } from 'svelte/store';
import { taskStore } from '@reborn/storage';
import { createLogger } from '@reborn/utils';

const logger = createLogger('TaskCounts');

export interface TaskCounts {
	byList: Record<string, number>;
	starred: number;
	trash: number;
	completed: number;
}

const EMPTY_COUNTS: TaskCounts = {
	byList: {},
	starred: 0,
	trash: 0,
	completed: 0
};

function createTaskCountsStore() {
	const { subscribe, set } = writable<TaskCounts>(EMPTY_COUNTS);

	async function updateCounts() {
		try {
			// Single query — iterate once to compute all counts
			const allTasks = await taskStore.getAll();

			const byList: Record<string, number> = {};
			let starred = 0;
			let trash = 0;
			let completed = 0;

			for (const task of allTasks) {
				if (task.deleted_at) {
					trash++;
					continue;
				}

				// Skip templates from all other counts
				if (task.is_template) continue;

				if (task.is_completed) {
					completed++;
					continue;
				}

				// Active, non-deleted, non-template task
				if (task.task_list_id) {
					byList[task.task_list_id] = (byList[task.task_list_id] || 0) + 1;
				}

				if (task.is_starred) {
					starred++;
				}
			}

			set({ byList, starred, trash, completed });
		} catch (error: unknown) {
			logger.error('Failed to update task counts:', error);
			set(EMPTY_COUNTS);
		}
	}

	return {
		subscribe,
		refresh: updateCounts,
		initialize: updateCounts
	};
}

export const taskCounts = createTaskCountsStore();
