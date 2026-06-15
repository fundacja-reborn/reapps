import { get } from 'svelte/store';
import { goto } from '$lib/utils/navigation';
import { layoutStore } from '$lib/stores/layout.store';
import type { Section } from '$lib/components/layout/IconNav.svelte';

/**
 * Icon-rail sections that own a full-page list/filter view. The "lists" section
 * is handled separately in taskDetailReturnRoute() because it returns to the
 * specific list that was open, not a generic route.
 */
const SECTION_ROUTE: Partial<Record<Section, string>> = {
	all: '/all',
	starred: '/starred',
	overdue: '/overdue',
	today: '/today',
	upcoming: '/upcoming',
	no_date: '/no-date',
	trash: '/trash'
};

/**
 * The route to return to when a task detail view closes: the section the user
 * was in before opening the task. `activeSection` is persisted in layoutStore
 * and left untouched by the `/tasks/[id]` route, so it still reflects the
 * list/filter the user was looking at. For the "lists" section we go back to
 * the specific list (identified by the task's own list id). Returns null when
 * nothing maps - the caller should fall back to history.back().
 */
export function taskDetailReturnRoute(listId?: string | null): string | null {
	const section = get(layoutStore).activeSection;
	const mapped = SECTION_ROUTE[section];
	if (mapped) return mapped;
	if (section === 'lists' && listId && !['starred', 'completed', 'trash'].includes(listId)) {
		return `/lists/${listId}`;
	}
	return null;
}

/**
 * Navigate back to the view the user came from before opening a task detail.
 * Mirrors the icon-rail "back" convention so closing a task - via the mobile
 * back button, or because the open task was trashed elsewhere - lands on the
 * same list/filter the user was already looking at, instead of jumping to an
 * unrelated list view.
 */
export function goBackFromTaskDetail(listId?: string | null, opts?: { replace?: boolean }): void {
	const route = taskDetailReturnRoute(listId);
	if (route) {
		void goto(route, { replaceState: opts?.replace ?? false });
	} else {
		history.back();
	}
}
