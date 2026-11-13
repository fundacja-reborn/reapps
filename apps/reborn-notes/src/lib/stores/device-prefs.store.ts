import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';
import { clearSessionPlace, forgetRememberedPlace } from './start-place';
import {
  DEFAULT_NOTE_FONT,
  isNoteArabicFont,
  isNoteFont,
  type NoteArabicFont,
  type NoteFont
} from '$lib/utils/note-font';

const logger = createLogger('device-prefs');

/**
 * Per-device UI preferences.
 *
 * Unlike `appSettings` (E2E-synced across all of a user's devices), these live
 * ONLY in this device's localStorage and never sync. They capture how *this*
 * device should behave - e.g. a desktop where you mostly edit vs a phone where
 * you mostly read. There is no user content here (view-mode enums, flags,
 * text-size steps, font names and the start page), so plain localStorage is fine and
 * outside the Zero-Knowledge sync surface.
 */
export type NoteOpenMode = 'preview' | 'edit' | 'split';

/**
 * How the note list in the main area lays out its cards (issue #523): one
 * column (`list`) or 2-3 columns by width (`grid`). Only the desktop main area
 * offers the switch; the 24rem side panel and the phone always show the list.
 */
export const NOTE_LIST_LAYOUTS = ['list', 'grid'] as const;
export type NoteListLayout = (typeof NOTE_LIST_LAYOUTS)[number];

/**
 * What the app shows when it opens on this device (issue #511): one of the
 * rail's browsing sections, or `last` = reopen where you left off (section,
 * folder / tag / smart folder and the open note, see `start-place.ts`). Not
 * offered: Trash, Search, Shares (not a place to start from) and the periodic
 * notes (opening one creates the note for the period).
 */
export const START_PAGES = ['all', 'starred', 'folders', 'tags', 'last'] as const;
export type StartPage = (typeof START_PAGES)[number];

/**
 * Interface scale steps, in percent of the browser's default font size.
 * Applied as `font-size: N%` on `<html>`, so everything sized in `rem`
 * (text, icons, spacing, controls) grows together, like browser zoom.
 *
 * No step below 100%: iOS zooms the page when a field with text under 16px
 * gets focus, and on desktop the browser's own zoom already shrinks the UI.
 * The top stays at 150% because above it the phone headers and the note list
 * no longer fit a 360px-wide screen.
 */
export const UI_SCALE_STEPS = [100, 110, 125, 150] as const;
export type UiScale = (typeof UI_SCALE_STEPS)[number];

/**
 * Note text steps, in percent RELATIVE to the interface scale (they multiply:
 * 125% interface x 150% note text = note text at 187.5% of the default). Exposed
 * to CSS as `--rn-note-scale` and used by the editor, the rendered preview and
 * the note title. Goes further than the interface because note content reflows,
 * and on iOS native (WKWebView ignores the system text size) this is the only
 * way to get large reading text.
 */
export const NOTE_TEXT_SCALE_STEPS = [100, 110, 125, 150, 175, 200] as const;
export type NoteTextScale = (typeof NOTE_TEXT_SCALE_STEPS)[number];

/** Default for both scales (no inline style is written at this value). */
export const DEFAULT_TEXT_SCALE = 100;

export interface DevicePrefs {
  /**
   * View mode an EXISTING note opens in when selected. Newly created notes
   * always open in 'edit' regardless (you just made it to write in it).
   */
  noteOpenMode: NoteOpenMode;
  /**
   * Desktop only: the note-list panel (the column between the icon rail and the
   * editor) is collapsed, leaving just the always-visible icon rail. Lets you
   * hand the freed width to the editor / docked outline. Ignored on mobile,
   * which uses a separate master-detail layout.
   */
  noteListCollapsed: boolean;
  /**
   * Desktop only: the outline (table of contents) is docked beside the editor
   * instead of opening as a transient overlay drawer. Global across notes on
   * this device; the dock auto-hides for notes that have no headings. Ignored
   * on mobile, which always uses the drawer.
   */
  tocPinned: boolean;
  /**
   * Interface scale for this device (issue #511). A property of the screen
   * (a phone held close vs a desktop monitor), so it stays per device.
   */
  uiScale: UiScale;
  /** Note text size on this device, relative to {@link DevicePrefs.uiScale}. */
  noteTextScale: NoteTextScale;
  /**
   * Font of note content in Latin script on this device (issue #546). Kept per
   * device next to the text size: both are about how this screen reads.
   */
  noteFont: NoteFont;
  /** Font of note content in Arabic script on this device (issue #546). */
  noteArabicFont: NoteArabicFont;
  /**
   * What the app opens on, on this device (issue #511). A habit tied to the
   * screen (a phone you browse folders on vs a desktop you write on), so it
   * stays per device rather than in the synced settings bundle.
   */
  startPage: StartPage;
  /**
   * Card layout of the note list in the desktop main area (issue #523). A
   * matter of screen width, so it stays per device; defaults to the list.
   */
  noteListLayout: NoteListLayout;
  /**
   * Phone layout only: show the floating "New note" button in the bottom corner
   * of the list (issue #541). On by default - creating a note is the app's main
   * action and the rail's button sits in the corner the thumb reaches last. A
   * matter of how this device is held, so it stays per device.
   */
  newNoteFab: boolean;
}

const STORAGE_KEY = 'reborn-notes-device-prefs';

const DEFAULTS: DevicePrefs = {
  noteOpenMode: 'preview',
  noteListCollapsed: false,
  tocPinned: false,
  uiScale: DEFAULT_TEXT_SCALE,
  noteTextScale: DEFAULT_TEXT_SCALE,
  noteFont: DEFAULT_NOTE_FONT,
  noteArabicFont: DEFAULT_NOTE_FONT,
  startPage: 'all',
  noteListLayout: 'list',
  newNoteFab: true
};

const NOTE_OPEN_MODES: readonly NoteOpenMode[] = ['preview', 'edit', 'split'];

export function isStartPage(value: unknown): value is StartPage {
  return (START_PAGES as readonly unknown[]).includes(value);
}

function isNoteListLayout(value: unknown): value is NoteListLayout {
  return (NOTE_LIST_LAYOUTS as readonly unknown[]).includes(value);
}

function isUiScale(value: unknown): value is UiScale {
  return (UI_SCALE_STEPS as readonly unknown[]).includes(value);
}

function isNoteTextScale(value: unknown): value is NoteTextScale {
  return (NOTE_TEXT_SCALE_STEPS as readonly unknown[]).includes(value);
}

/**
 * The next step up (`direction` 1) or down (-1) from `current`, clamped to the
 * ends of `steps`. A value that is not a step (should not happen - `load()`
 * validates) snaps to the default.
 */
export function stepTextScale<T extends number>(
  steps: readonly T[],
  current: T,
  direction: 1 | -1
): T {
  const index = steps.indexOf(current);
  if (index === -1) return steps[0];
  const next = Math.min(steps.length - 1, Math.max(0, index + direction));
  return steps[next];
}

/**
 * Writes the text-size preferences onto `<html>`. At the default nothing is
 * written, so the app's own CSS (and the browser's default font size) applies
 * untouched. The interface scale is a percentage, not px, so a user who raised
 * the browser's default font size keeps that on top of ours.
 */
export function applyTextSize(
  root: HTMLElement,
  prefs: Pick<DevicePrefs, 'uiScale' | 'noteTextScale'>
): void {
  if (prefs.uiScale === DEFAULT_TEXT_SCALE) {
    root.style.removeProperty('font-size');
  } else {
    root.style.setProperty('font-size', `${prefs.uiScale}%`);
  }
  if (prefs.noteTextScale === DEFAULT_TEXT_SCALE) {
    root.style.removeProperty('--rn-note-scale');
  } else {
    root.style.setProperty('--rn-note-scale', String(prefs.noteTextScale / 100));
  }
}

function load(): DevicePrefs {
  if (!browser) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    return {
      noteOpenMode: NOTE_OPEN_MODES.includes(parsed.noteOpenMode as NoteOpenMode)
        ? (parsed.noteOpenMode as NoteOpenMode)
        : DEFAULTS.noteOpenMode,
      noteListCollapsed:
        typeof parsed.noteListCollapsed === 'boolean'
          ? parsed.noteListCollapsed
          : DEFAULTS.noteListCollapsed,
      tocPinned:
        typeof parsed.tocPinned === 'boolean' ? parsed.tocPinned : DEFAULTS.tocPinned,
      uiScale: isUiScale(parsed.uiScale) ? parsed.uiScale : DEFAULTS.uiScale,
      noteTextScale: isNoteTextScale(parsed.noteTextScale)
        ? parsed.noteTextScale
        : DEFAULTS.noteTextScale,
      noteFont: isNoteFont(parsed.noteFont) ? parsed.noteFont : DEFAULTS.noteFont,
      noteArabicFont: isNoteArabicFont(parsed.noteArabicFont)
        ? parsed.noteArabicFont
        : DEFAULTS.noteArabicFont,
      startPage: isStartPage(parsed.startPage) ? parsed.startPage : DEFAULTS.startPage,
      noteListLayout: isNoteListLayout(parsed.noteListLayout)
        ? parsed.noteListLayout
        : DEFAULTS.noteListLayout,
      newNoteFab:
        typeof parsed.newNoteFab === 'boolean' ? parsed.newNoteFab : DEFAULTS.newNoteFab
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

  function setNoteListCollapsed(collapsed: boolean): void {
    store.update((prev) => {
      const next = { ...prev, noteListCollapsed: collapsed };
      persist(next);
      return next;
    });
  }

  function toggleNoteList(): void {
    store.update((prev) => {
      const next = { ...prev, noteListCollapsed: !prev.noteListCollapsed };
      persist(next);
      return next;
    });
  }

  function setTocPinned(pinned: boolean): void {
    store.update((prev) => {
      const next = { ...prev, tocPinned: pinned };
      persist(next);
      return next;
    });
  }

  function setUiScale(scale: UiScale): void {
    if (!isUiScale(scale)) return;
    store.update((prev) => {
      const next = { ...prev, uiScale: scale };
      persist(next);
      return next;
    });
  }

  function setNoteTextScale(scale: NoteTextScale): void {
    if (!isNoteTextScale(scale)) return;
    store.update((prev) => {
      const next = { ...prev, noteTextScale: scale };
      persist(next);
      return next;
    });
  }

  function setNoteFont(font: NoteFont): void {
    if (!isNoteFont(font)) return;
    store.update((prev) => {
      const next = { ...prev, noteFont: font };
      persist(next);
      return next;
    });
  }

  function setNoteArabicFont(font: NoteArabicFont): void {
    if (!isNoteArabicFont(font)) return;
    store.update((prev) => {
      const next = { ...prev, noteArabicFont: font };
      persist(next);
      return next;
    });
  }

  /** Both note fonts back to the default (Appearance > Reset to defaults). */
  function resetNoteFont(): void {
    store.update((prev) => {
      const next = {
        ...prev,
        noteFont: DEFAULTS.noteFont,
        noteArabicFont: DEFAULTS.noteArabicFont
      };
      persist(next);
      return next;
    });
  }

  /**
   * Choosing any start page other than `last` also drops the remembered place,
   * so the device keeps no trace of the last open note it no longer needs, and
   * the session place, so coming back from Settings opens the new start page
   * right away (see `clearSessionPlace`).
   */
  function setStartPage(page: StartPage): void {
    if (!isStartPage(page)) return;
    store.update((prev) => {
      if (page !== 'last') {
        forgetRememberedPlace();
        if (prev.startPage !== page) clearSessionPlace();
      }
      const next = { ...prev, startPage: page };
      persist(next);
      return next;
    });
  }

  function setNoteListLayout(layout: NoteListLayout): void {
    if (!isNoteListLayout(layout)) return;
    store.update((prev) => {
      const next = { ...prev, noteListLayout: layout };
      persist(next);
      return next;
    });
  }

  function setNewNoteFab(enabled: boolean): void {
    store.update((prev) => {
      const next = { ...prev, newNoteFab: enabled };
      persist(next);
      return next;
    });
  }

  /** Both text sizes back to the default (Appearance > Reset to defaults). */
  function resetTextSize(): void {
    store.update((prev) => {
      const next = {
        ...prev,
        uiScale: DEFAULTS.uiScale,
        noteTextScale: DEFAULTS.noteTextScale
      };
      persist(next);
      return next;
    });
  }

  return {
    subscribe: store.subscribe,
    setNoteOpenMode,
    setNoteListCollapsed,
    toggleNoteList,
    setTocPinned,
    setUiScale,
    setNoteTextScale,
    resetTextSize,
    setNoteFont,
    setNoteArabicFont,
    resetNoteFont,
    setStartPage,
    setNoteListLayout,
    setNewNoteFab
  };
}

export const devicePrefs = createDevicePrefsStore();

/** The view mode an existing note opens in on this device. */
export const noteOpenMode = derived(devicePrefs, ($p) => $p.noteOpenMode);

/** Desktop: whether the note-list panel is collapsed (icon rail stays visible). */
export const noteListCollapsed = derived(devicePrefs, ($p) => $p.noteListCollapsed);

/** Desktop: whether the outline is docked beside the editor (global, this device). */
export const tocPinned = derived(devicePrefs, ($p) => $p.tocPinned);

/** Interface scale on this device, in percent (see {@link UI_SCALE_STEPS}). */
export const uiScale = derived(devicePrefs, ($p) => $p.uiScale);

/** Note text size on this device, in percent of the interface scale. */
export const noteTextScale = derived(devicePrefs, ($p) => $p.noteTextScale);

/** What the app opens on, on this device (see {@link START_PAGES}). */
export const startPage = derived(devicePrefs, ($p) => $p.startPage);

/** Card layout of the desktop main-area note list (see {@link NOTE_LIST_LAYOUTS}). */
export const noteListLayout = derived(devicePrefs, ($p) => $p.noteListLayout);

/** Phone layout: whether the floating "New note" button is shown on this device. */
export const newNoteFab = derived(devicePrefs, ($p) => $p.newNoteFab);
