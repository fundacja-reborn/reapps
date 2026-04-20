import { writable } from 'svelte/store';
import type { ListDecrypted, TaskDecrypted } from '@reborn/types';
import type { Section } from '$lib/components/layout/IconNav.svelte';
import type { TaskFilters } from '$lib/services/task-filtering.service';

/**
 * State for dialog management in the layout
 */
interface LayoutState {
	// Navigation
	activeSection: Section;

	// Task list filters (shared between header and page)
	taskFilters: TaskFilters;

	// List dialogs
	createListOpen: boolean;
	editDialogOpen: boolean;
	deleteDialogOpen: boolean;
	selectedListForDialog: ListDecrypted | null;

	// Task dialogs
	taskDeleteDialogOpen: boolean;
	moveTaskDialogOpen: boolean;
	selectedTaskForDialog: TaskDecrypted | null;
}

const initialState: LayoutState = {
	activeSection: 'all',
	taskFilters: { option: 'all' },
	createListOpen: false,
	editDialogOpen: false,
	deleteDialogOpen: false,
	selectedListForDialog: null,
	taskDeleteDialogOpen: false,
	moveTaskDialogOpen: false,
	selectedTaskForDialog: null
};

function createLayoutStore() {
	const { subscribe, update, set } = writable<LayoutState>(initialState);

	return {
		subscribe,
		reset: () => set(initialState),

		// Navigation
		setSection: (section: Section) => update((state) => ({ ...state, activeSection: section })),

		// Task filters
		setTaskFilters: (filters: TaskFilters) =>
			update((state) => ({ ...state, taskFilters: filters })),
		resetTaskFilters: () => update((state) => ({ ...state, taskFilters: { option: 'all' } })),

		// List dialog methods
		openCreateList: () => update((state) => ({ ...state, createListOpen: true })),
		closeCreateList: () => update((state) => ({ ...state, createListOpen: false })),

		openEditDialog: (list: ListDecrypted) =>
			update((state) => ({
				...state,
				editDialogOpen: true,
				selectedListForDialog: list
			})),
		closeEditDialog: () =>
			update((state) => ({
				...state,
				editDialogOpen: false,
				selectedListForDialog: null
			})),

		openDeleteDialog: (list: ListDecrypted) =>
			update((state) => ({
				...state,
				deleteDialogOpen: true,
				selectedListForDialog: list
			})),
		closeDeleteDialog: () =>
			update((state) => ({
				...state,
				deleteDialogOpen: false,
				selectedListForDialog: null
			})),

		// Task dialog methods
		openTaskDeleteDialog: (task: TaskDecrypted) =>
			update((state) => ({
				...state,
				taskDeleteDialogOpen: true,
				selectedTaskForDialog: task
			})),
		closeTaskDeleteDialog: () =>
			update((state) => ({
				...state,
				taskDeleteDialogOpen: false,
				selectedTaskForDialog: null
			})),

		openMoveTaskDialog: (task: TaskDecrypted) =>
			update((state) => ({
				...state,
				moveTaskDialogOpen: true,
				selectedTaskForDialog: task
			})),
		closeMoveTaskDialog: () =>
			update((state) => ({
				...state,
				moveTaskDialogOpen: false,
				selectedTaskForDialog: null
			}))
	};
}

export const layoutStore = createLayoutStore();
