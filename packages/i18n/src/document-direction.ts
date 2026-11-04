/**
 * Browser-side wiring of the UI text direction: `<html lang/dir>`, the
 * `textDirection` store and the `?dir=rtl` debug override. The pure locale ->
 * direction mapping lives in direction.ts.
 */
import { writable, type Readable } from 'svelte/store';
import { getTextDirection, isTextDirection, type TextDirection } from './direction';

// ── Debug override (`?dir=rtl`) ────────────────────────────────────────
//
// Forces the UI direction regardless of locale, so the RTL layout can be
// smoke-tested with English strings before any RTL translation exists.
// `?dir=rtl` / `?dir=ltr` sets it, `?dir=auto` clears it. Persisted in
// localStorage because client-side navigation drops the query string. Pure
// presentation: it changes CSS direction only, never data.

export const DIRECTION_OVERRIDE_PARAM = 'dir';
export const DIRECTION_OVERRIDE_STORAGE_KEY = 'reborn-dir-override';

/**
 * Read the direction override from `search` (a `location.search` string),
 * persisting or clearing it as requested. Returns the active override, or
 * `null` when the UI should follow the locale.
 */
export function readDirectionOverride(search: string): TextDirection | null {
  let storage: Storage | undefined;
  try {
    storage = typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    storage = undefined; // storage access can throw (privacy modes)
  }

  const param = new URLSearchParams(search).get(DIRECTION_OVERRIDE_PARAM)?.toLowerCase();
  try {
    if (isTextDirection(param)) {
      storage?.setItem(DIRECTION_OVERRIDE_STORAGE_KEY, param);
      return param;
    }
    if (param !== undefined) {
      // `?dir=auto` (or any other value) switches the override off.
      storage?.removeItem(DIRECTION_OVERRIDE_STORAGE_KEY);
      return null;
    }
    const stored = storage?.getItem(DIRECTION_OVERRIDE_STORAGE_KEY);
    return isTextDirection(stored) ? stored : null;
  } catch {
    return isTextDirection(param) ? param : null;
  }
}

// ── Current document direction ────────────────────────────────────────

function initialDirection(): TextDirection {
  if (typeof document === 'undefined') return 'ltr';
  return document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
}

const directionStore = writable<TextDirection>(initialDirection());

/**
 * The direction currently applied to `<html dir>`. Components that render
 * outside the normal flow and need an explicit `dir` prop (bits-ui floating
 * content portals to `<body>` and defaults its wrapper to `dir="ltr"`)
 * subscribe to this.
 */
export const textDirection: Readable<TextDirection> = { subscribe: directionStore.subscribe };

/**
 * Apply a UI locale to the document: sets `<html lang>` and `<html dir>`
 * (the override wins over the locale's own direction) and updates
 * `textDirection`. Returns the applied direction. No-op outside the browser.
 */
export function applyDocumentLocale(
  locale: string,
  override: TextDirection | null = null
): TextDirection {
  const dir = override ?? getTextDirection(locale);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (root.lang !== locale) root.lang = locale;
    if (root.dir !== dir) root.dir = dir;
  }
  directionStore.set(dir);
  return dir;
}
