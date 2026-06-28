import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';

const logger = createLogger('device-prefs');

/**
 * Per-device UI preferences.
 *
 * Unlike `appSettings` (E2E-synced across all of a user's devices), these live
 * ONLY in this device's localStorage and never sync. They capture how *this*
 * device should behave - e.g. a desktop where you mostly edit vs a phone where
 * you mostly read. There is no user content here (just a view-mode enum), so
 * plain localStorage is fine and outside the Zero-Knowledge sync surface.
 */
export type NoteOpenMode = 'preview' | 'edit' | 'split';

export interface DevicePrefs {
  /**
   * View mode an EXISTING note opens in when selected. Newly created notes
   * always open in 'edit' regardless (you just made it to write in it).
   */
  noteOpenMode: NoteOpenMode;
}

const STORAGE_KEY = 'reborn-notes-device-prefs';

const DEFAULTS: DevicePrefs = {
  noteOpenMode: 'preview'
};

const NOTE_OPEN_MODES: readonly NoteOpenMode[] = ['preview', 'edit', 'split'];

function load(): DevicePrefs {
  if (!browser) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    return {
      noteOpenMode: NOTE_OPEN_MODES.includes(parsed.noteOpenMode as NoteOpenMode)
        ? (parsed.noteOpenMode as NoteOpenMode)
        : DEFAULTS.noteOpenMode
    };
  } catch (err) {
    logger.warn('Failed to read device prefs, using defaults', err);
    return { ...DEFAULTS };
  }
}

function persist(prefs: DevicePrefs): void {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (err) {
    // Quota / private mode - keep the in-memory value, just skip persistence.
    logger.warn('Failed to persist device prefs', err);
  }
}

function createDevicePrefsStore() {
  const store = writable<DevicePrefs>(load());

  function setNoteOpenMode(mode: NoteOpenMode): void {
    store.update((prev) => {
      const next = { ...prev, noteOpenMode: mode };
      persist(next);
      return next;
    });
  }

  return {
    subscribe: store.subscribe,
    setNoteOpenMode
  };
}

export const devicePrefs = createDevicePrefsStore();

/** The view mode an existing note opens in on this device. */
export const noteOpenMode = derived(devicePrefs, ($p) => $p.noteOpenMode);
