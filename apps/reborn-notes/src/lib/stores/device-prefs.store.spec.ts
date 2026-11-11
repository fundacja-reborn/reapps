// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Per-device prefs from issue #511 (localStorage, never synced, validated on
 * load): text size (interface scale + note text size, written onto <html> by
 * `applyTextSize`) and the start page.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const STORAGE_KEY = 'reborn-notes-device-prefs';

async function loadStore() {
  vi.resetModules();
  return import('./device-prefs.store');
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

describe('device prefs: text size', () => {
  it('defaults both scales to 100% and keeps the existing prefs', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ noteOpenMode: 'edit', noteListCollapsed: true, tocPinned: true })
    );
    const { devicePrefs } = await loadStore();
    expect(get(devicePrefs)).toEqual({
      noteOpenMode: 'edit',
      noteListCollapsed: true,
      tocPinned: true,
      uiScale: 100,
      noteTextScale: 100,
      startPage: 'all',
      noteListLayout: 'list'
    });
  });

  it('reads saved steps back', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiScale: 125, noteTextScale: 175 }));
    const { uiScale, noteTextScale } = await loadStore();
    expect(get(uiScale)).toBe(125);
    expect(get(noteTextScale)).toBe(175);
  });

  it.each([
    ['below the range', 90, 50],
    ['above the range', 175, 300],
    ['not a step', 120, 130],
    ['a numeric string', '125', '150'],
    ['null', null, null]
  ])('falls back to 100%% for a stored value %s', async (_label, ui, note) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiScale: ui, noteTextScale: note }));
    const { devicePrefs } = await loadStore();
    expect(get(devicePrefs).uiScale).toBe(100);
    expect(get(devicePrefs).noteTextScale).toBe(100);
  });

  it('keeps the interface at most 150% and the note text at most 200%', async () => {
    const { UI_SCALE_STEPS, NOTE_TEXT_SCALE_STEPS } = await loadStore();
    expect(UI_SCALE_STEPS).toEqual([100, 110, 125, 150]);
    expect(NOTE_TEXT_SCALE_STEPS).toEqual([100, 110, 125, 150, 175, 200]);
  });

  it('persists a change and resets both scales without touching other prefs', async () => {
    const { devicePrefs } = await loadStore();
    devicePrefs.setTocPinned(true);
    devicePrefs.setUiScale(150);
    devicePrefs.setNoteTextScale(200);
    expect(stored()).toMatchObject({ tocPinned: true, uiScale: 150, noteTextScale: 200 });

    devicePrefs.resetTextSize();
    expect(stored()).toMatchObject({ tocPinned: true, uiScale: 100, noteTextScale: 100 });
    expect(get(devicePrefs).tocPinned).toBe(true);
  });

  it('ignores a value that is not a step', async () => {
    const { devicePrefs } = await loadStore();
    devicePrefs.setUiScale(125);
    devicePrefs.setUiScale(175 as never);
    devicePrefs.setNoteTextScale(90 as never);
    expect(get(devicePrefs).uiScale).toBe(125);
    expect(get(devicePrefs).noteTextScale).toBe(100);
  });
});

describe('device prefs: start page (#511)', () => {
  const PLACE_KEY = 'reborn-notes-last-place';

  it('opens All notes by default', async () => {
    const { startPage } = await loadStore();
    expect(get(startPage)).toBe('all');
  });

  it('offers the rail sections plus "where you left off", nothing else', async () => {
    const { START_PAGES } = await loadStore();
    expect(START_PAGES).toEqual(['all', 'starred', 'folders', 'tags', 'last']);
  });

  it.each(['all', 'starred', 'folders', 'tags', 'last'])('reads a saved %s back', async (page) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ startPage: page }));
    const { startPage } = await loadStore();
    expect(get(startPage)).toBe(page);
  });

  it.each([
    ['Trash', 'trash'],
    ['Search', 'search'],
    ['a periodic section', 'periodic-daily'],
    ['a folder id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    ['a number', 1],
    ['null', null]
  ])('falls back to All notes for a stored %s', async (_label, value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ startPage: value, tocPinned: true }));
    const { devicePrefs } = await loadStore();
    expect(get(devicePrefs).startPage).toBe('all');
    // A bad start page does not cost the other prefs.
    expect(get(devicePrefs).tocPinned).toBe(true);
  });

  it('persists the choice and ignores an unknown one', async () => {
    const { devicePrefs, startPage } = await loadStore();
    devicePrefs.setStartPage('folders');
    expect(stored()).toMatchObject({ startPage: 'folders' });
    devicePrefs.setStartPage('trash' as never);
    expect(get(startPage)).toBe('folders');
  });

  it('drops the remembered place when "where you left off" is turned off', async () => {
    const { devicePrefs } = await loadStore();
    devicePrefs.setStartPage('last');
    localStorage.setItem(PLACE_KEY, JSON.stringify({ v: 1, account: 'x', section: 'all' }));
    // Choosing it again keeps the place.
    devicePrefs.setStartPage('last');
    expect(localStorage.getItem(PLACE_KEY)).not.toBeNull();
    devicePrefs.setStartPage('starred');
    expect(localStorage.getItem(PLACE_KEY)).toBeNull();
  });

  it('a different start page opens on the next mount, "where you left off" keeps the place', async () => {
    const { devicePrefs } = await loadStore();
    // Same module instance as the store's (one registry after resetModules).
    const place = await import('./start-place');
    const account = 'acc';

    place.setSessionPlace({ section: 'tags' }, account);
    devicePrefs.setStartPage('all'); // already the start page: nothing changes
    expect(place.getSessionPlace(account)).toEqual({ section: 'tags' });

    devicePrefs.setStartPage('last');
    expect(place.getSessionPlace(account)).toEqual({ section: 'tags' });

    devicePrefs.setStartPage('folders');
    expect(place.getSessionPlace(account)).toBeNull();
  });
});

describe('device prefs: note list layout (#523)', () => {
  it('shows the list by default', async () => {
    const { noteListLayout, NOTE_LIST_LAYOUTS } = await loadStore();
    expect(get(noteListLayout)).toBe('list');
    expect(NOTE_LIST_LAYOUTS).toEqual(['list', 'grid']);
  });

  it('persists the grid and reads it back on the next load', async () => {
    const first = await loadStore();
    first.devicePrefs.setNoteListLayout('grid');
    expect(stored()).toMatchObject({ noteListLayout: 'grid' });
    const second = await loadStore();
    expect(get(second.noteListLayout)).toBe('grid');
  });

  it('ignores an unknown layout', async () => {
    const { devicePrefs, noteListLayout } = await loadStore();
    devicePrefs.setNoteListLayout('grid');
    devicePrefs.setNoteListLayout('compact' as never);
    expect(get(noteListLayout)).toBe('grid');
  });

  it.each([
    ['an unknown layout', 'compact'],
    ['a number', 2],
    ['null', null]
  ])('falls back to the list for a stored %s', async (_label, value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ noteListLayout: value, tocPinned: true }));
    const { devicePrefs } = await loadStore();
    expect(get(devicePrefs).noteListLayout).toBe('list');
    // A bad layout does not cost the other prefs.
    expect(get(devicePrefs).tocPinned).toBe(true);
  });
});

describe('stepTextScale', () => {
  it('moves one step and stops at both ends', async () => {
    const { stepTextScale, UI_SCALE_STEPS } = await loadStore();
    expect(stepTextScale(UI_SCALE_STEPS, 100, 1)).toBe(110);
    expect(stepTextScale(UI_SCALE_STEPS, 125, -1)).toBe(110);
    expect(stepTextScale(UI_SCALE_STEPS, 150, 1)).toBe(150);
    expect(stepTextScale(UI_SCALE_STEPS, 100, -1)).toBe(100);
  });

  it('snaps an unknown value to the first step', async () => {
    const { stepTextScale, NOTE_TEXT_SCALE_STEPS } = await loadStore();
    expect(stepTextScale(NOTE_TEXT_SCALE_STEPS, 130 as never, 1)).toBe(100);
  });
});

describe('applyTextSize', () => {
  it('writes nothing at the default, so the app CSS applies untouched', async () => {
    const { applyTextSize } = await loadStore();
    const root = document.documentElement;
    applyTextSize(root, { uiScale: 100, noteTextScale: 100 });
    expect(root.style.fontSize).toBe('');
    expect(root.style.getPropertyValue('--rn-note-scale')).toBe('');
  });

  it('sets the interface scale as a percentage and the note multiplier as a number', async () => {
    const { applyTextSize } = await loadStore();
    const root = document.documentElement;
    applyTextSize(root, { uiScale: 125, noteTextScale: 175 });
    // A percentage (not px) keeps a larger default font size from the browser
    // settings on top of ours.
    expect(root.style.fontSize).toBe('125%');
    expect(root.style.getPropertyValue('--rn-note-scale')).toBe('1.75');
  });

  it('removes both again when set back to the default', async () => {
    const { applyTextSize } = await loadStore();
    const root = document.documentElement;
    applyTextSize(root, { uiScale: 150, noteTextScale: 200 });
    applyTextSize(root, { uiScale: 100, noteTextScale: 100 });
    expect(root.style.fontSize).toBe('');
    expect(root.style.getPropertyValue('--rn-note-scale')).toBe('');
  });
});
