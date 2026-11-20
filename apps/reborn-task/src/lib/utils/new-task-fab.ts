/**
 * Filter sections whose list a new task lands in: quick-add gives the task
 * what the view needs (today's date, a star, tomorrow's date) or the view
 * shows every task anyway. Overdue and Trash are left out on purpose: a new
 * task belongs to neither, so "New task" has to leave them for the default
 * list. The rail's button still does that from anywhere.
 */
export const NEW_TASK_FAB_SECTIONS = ['all', 'today', 'starred', 'upcoming', 'no_date'] as const;

/**
 * When the phone layout shows the floating "New task" button.
 *
 * In {@link NEW_TASK_FAB_SECTIONS} and in an open list. Not in the list
 * catalog: there a "+" reads as "add a list". It also steps aside while a
 * field in the panel has focus, so it never floats over the text being typed
 * when the keyboard resizes the view, and while a filter view is being
 * searched: the quick-add field is hidden then, so there is nothing to focus.
 */
export function showNewTaskFab(state: {
	/** The per-device preference (Settings > Appearance). */
	enabled: boolean;
	/** The active rail section. */
	section: string;
	/** In the Lists section: a list is open (not the list catalog). */
	listOpen: boolean;
	/** A search query is active in a filter view. */
	searching: boolean;
	/** A text field in the panel has focus. */
	typing: boolean;
}): boolean {
	if (!state.enabled || state.typing) return false;
	if (state.section === 'lists') return state.listOpen;
	if (state.searching) return false;
	return (NEW_TASK_FAB_SECTIONS as readonly string[]).includes(state.section);
}
