/**
 * The app menu of the desktop shell on macOS (`src-tauri/src/app_menu.rs`).
 *
 * The menu is native, but its texts follow the app's language rather than the
 * system's: the page sends them (keys `desktop.menu.*`) at startup and on each
 * language change. The shell keeps English texts until then. "Settings..."
 * comes back as an event, so the page decides where it leads.
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

/** Call `handler` when the user picks "Settings...". Returns an unsubscribe. */
export function onDesktopMenuSettings(handler: () => void): () => void {
  const events = getDesktopBridge()?.event;
  if (!events) return () => {};
  let stop: (() => void) | null = null;
  let stopped = false;
  events.listen(DESKTOP_MENU_SETTINGS_EVENT, () => handler()).then(
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
