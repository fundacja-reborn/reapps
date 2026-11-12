// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isTextEntryTarget, showNewNoteFab } from './new-note-fab';

/**
 * Floating "New note" button of the phone layout (issue #541): where it shows
 * and when it steps aside.
 */

const base = { enabled: true, section: 'all', selectionActive: false, typing: false };

describe('showNewNoteFab', () => {
  it.each(['all', 'starred', 'folders', 'tags'])('shows in the %s section', (section) => {
    expect(showNewNoteFab({ ...base, section })).toBe(true);
  });

  it.each(['trash', 'search', 'shares', 'periodic-daily', 'periodic-weekly', 'periodic-monthly'])(
    'stays out of the %s section',
    (section) => {
      expect(showNewNoteFab({ ...base, section })).toBe(false);
    }
  );

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

describe('isTextEntryTarget', () => {
  function el(html: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
  }

  it.each([
    ['a text input', '<input />'],
    ['a search input', '<input type="search" />'],
    ['a textarea', '<textarea></textarea>']
  ])('is true for %s', (_label, html) => {
    expect(isTextEntryTarget(el(html))).toBe(true);
  });

  it.each([
    ['a button', '<button type="button"></button>'],
    ['a checkbox', '<input type="checkbox" />'],
    ['a plain element', '<div></div>']
  ])('is false for %s', (_label, html) => {
    expect(isTextEntryTarget(el(html))).toBe(false);
  });

  it('is false for no target', () => {
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
