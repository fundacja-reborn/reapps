import { writable } from 'svelte/store';

/**
 * Global store to track which swipeable item is currently open
 * This ensures only one item can be swiped open at a time
 */
function createSwipeStore() {
	const { subscribe, set } = writable<string | null>(null);

	return {
		subscribe,
		setOpenItemId: (id: string | null) => set(id),
		clear: () => set(null)
	};
}

export const swipeStore = createSwipeStore();
