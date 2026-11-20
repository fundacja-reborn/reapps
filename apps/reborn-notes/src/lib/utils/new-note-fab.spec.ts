import { describe, it, expect } from 'vitest';
import { showNewNoteFab } from './new-note-fab';

/**
 * Floating "New note" button of the phone layout (issue #541): where it shows
 * and when it steps aside.
 */

const base = { enabled: true, section: 'all', selectionActive: false, typing: false };

describe('showNewNoteFab', () => {
  it.each(['all', 'folders'])('shows in the %s section', (section) => {
    expect(showNewNoteFab({ ...base, section })).toBe(true);
  });

  // Starred and Tags: a new note has no star / tag, so it would not show up in
  // the list the button floats over.
  it.each([
    'starred',
    'tags',
    'trash',
    'search',
    'shares',
    'periodic-daily',
    'periodic-weekly',
    'periodic-monthly'
  ])('stays out of the %s section', (section) => {
    expect(showNewNoteFab({ ...base, section })).toBe(false);
  });

  it('is hidden when the device turned it off', () => {
    expect(showNewNoteFab({ ...base, enabled: false })).toBe(false);
  });

  it('steps aside while notes are being selected', () => {
    expect(showNewNoteFab({ ...base, selectionActive: true })).toBe(false);
  });

  it('steps aside while a field in the list panel has focus', () => {
    expect(showNewNoteFab({ ...base, typing: true })).toBe(false);
  });
});
