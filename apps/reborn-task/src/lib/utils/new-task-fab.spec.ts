import { describe, it, expect } from 'vitest';
import { showNewTaskFab } from './new-task-fab';

/**
 * Floating "New task" button of the phone layout: where it shows and when it
 * steps aside.
 */

const base = { enabled: true, section: 'all', listOpen: false, searching: false, typing: false };

describe('showNewTaskFab', () => {
	it.each(['all', 'today', 'starred', 'upcoming', 'no_date'])(
		'shows in the %s filter',
		(section) => {
			expect(showNewTaskFab({ ...base, section })).toBe(true);
		}
	);

	// A new task is neither overdue nor deleted, so it would not show up in the
	// list the button floats over.
	it.each(['overdue', 'trash'])('stays out of the %s section', (section) => {
		expect(showNewTaskFab({ ...base, section })).toBe(false);
	});

	it('shows in an open list', () => {
		expect(showNewTaskFab({ ...base, section: 'lists', listOpen: true })).toBe(true);
	});

	// In the catalog a "+" reads as "add a list".
	it('stays out of the list catalog', () => {
		expect(showNewTaskFab({ ...base, section: 'lists', listOpen: false })).toBe(false);
	});

	it('ignores an open list outside the Lists section', () => {
		expect(showNewTaskFab({ ...base, section: 'trash', listOpen: true })).toBe(false);
	});

	it('is hidden when the device turned it off', () => {
		expect(showNewTaskFab({ ...base, enabled: false })).toBe(false);
		expect(showNewTaskFab({ ...base, enabled: false, section: 'lists', listOpen: true })).toBe(
			false
		);
	});

	it('steps aside while a field in the panel has focus', () => {
		expect(showNewTaskFab({ ...base, typing: true })).toBe(false);
		expect(showNewTaskFab({ ...base, typing: true, section: 'lists', listOpen: true })).toBe(
			false
		);
	});

	// Quick-add is hidden while a filter view is searched: nothing to focus.
	it('steps aside while a filter view is being searched', () => {
		expect(showNewTaskFab({ ...base, searching: true })).toBe(false);
	});

	// An open list has no search, and a query left over in the store from a
	// filter view must not hide the button there.
	it('ignores a search query in an open list', () => {
		expect(
			showNewTaskFab({ ...base, section: 'lists', listOpen: true, searching: true })
		).toBe(true);
	});
});
