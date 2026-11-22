/**
 * The app menu of the desktop shell on macOS (`src-tauri/src/app_menu.rs`).
 *
 * The menu is native, but its texts follow the app's language rather than the
 * system's: the page sends them (keys `desktop.menu.*`) at startup and on each
 * language change. The shell keeps English texts until then. "Settings..."
 * and "New Note" come back as events, so the page decides what they do on the
 * screen it shows.
 *
 * Desktop-only: callers sit behind `__REBORN_DESKTOP__`. On Windows and Linux
 * the shell has no menu and ignores the texts.
 */

import { getDesktopBridge, invokeDesktop } from './desktop-bridge';

/**
 * One key per translated menu text, the same keys as `DEFAULT_TEXTS` in
 * `app_menu.rs` (checked by `desktop-menu.spec.ts`).
 */
export const DESKTOP_MENU_KEYS = [
  'about',
  'settings',
  'services',
  'hide',
  'hide_others',
  'show_all',
  'quit',
  'file',
  'new_note',
  'edit',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'select_all',
  'view',
  'window',
  'minimize',
  'zoom',
  'close_window'
] as const;

export type DesktopMenuKey = (typeof DESKTOP_MENU_KEYS)[number];

/** Translation key of a menu text. */
export const desktopMenuMessageId = (key: DesktopMenuKey): string => `desktop.menu.${key}`;

/** Event the shell emits for "Settings..." (`OPEN_SETTINGS_EVENT` in Rust). */
export const DESKTOP_MENU_SETTINGS_EVENT = 'desktop-menu:settings';

/** Event the shell emits for "New Note" (`NEW_NOTE_EVENT` in Rust). */
export const DESKTOP_MENU_NEW_NOTE_EVENT = 'desktop-menu:new-note';

/**
 * The menu texts in the current language. A key without a translation comes
 * back from svelte-i18n as the key itself; it is left out, so that item keeps
 * the text it has.
 */
export function desktopMenuTexts(translate: (id: string) => string): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const key of DESKTOP_MENU_KEYS) {
    const id = desktopMenuMessageId(key);
    const text = translate(id);
    if (text && text !== id) texts[key] = text;
  }
  return texts;
}

/** Send the menu texts in the current language to the shell. Never rejects. */
export async function localizeDesktopMenu(translate: (id: string) => string): Promise<void> {
  try {
    await invokeDesktop<null>('desktop_menu_localize', { texts: desktopMenuTexts(translate) });
  } catch {
    // The menu keeps its previous texts; nothing else depends on them.
  }
}

/**
 * Whether "Settings..." may open the settings from this page. Not from the
 * sign-in and lock screens (the auth guard would send the user straight back,
 * and the lock screen would prompt again), nor from a public share view.
 */
export function canOpenSettingsFrom(pathname: string, base: string): boolean {
  return !pathname.startsWith(`${base}/auth/`) && !pathname.startsWith(`${base}/s/`);
}

/** Whether `pathname` is the notes view (the app's root route). */
export function isNotesView(pathname: string, base: string): boolean {
  if (!pathname.startsWith(base)) return false;
  return (pathname.slice(base.length) || '/') === '/';
}

/**
 * "New Note" picked outside the notes view (in Settings): the layout opens the
 * notes view and leaves this flag; the view creates the note once its start
 * place is open, so the restored place cannot cover the new note.
 */
let newNotePending = false;

export function setNewNotePending(): void {
  newNotePending = true;
}

/** Reads and clears the flag. */
export function takeNewNotePending(): boolean {
  const pending = newNotePending;
  newNotePending = false;
  return pending;
}

/** Call `handler` each time the shell emits `event`. Returns an unsubscribe. */
function onDesktopMenuEvent(event: string, handler: () => void): () => void {
  const events = getDesktopBridge()?.event;
  if (!events) return () => {};
  let stop: (() => void) | null = null;
  let stopped = false;
  events.listen(event, () => handler()).then(
    (unlisten) => {
      // Unsubscribed before the listener was in place: drop it right away.
      if (stopped) unlisten();
      else stop = unlisten;
    },
    () => {
      // No listener means the menu item does nothing; the app works on.
    }
  );
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Call `handler` when the user picks "Settings...". Returns an unsubscribe. */
export function onDesktopMenuSettings(handler: () => void): () => void {
  return onDesktopMenuEvent(DESKTOP_MENU_SETTINGS_EVENT, handler);
}

/** Call `handler` when the user picks "New Note" (Cmd+N). Returns an unsubscribe. */
export function onDesktopMenuNewNote(handler: () => void): () => void {
  return onDesktopMenuEvent(DESKTOP_MENU_NEW_NOTE_EVENT, handler);
}
