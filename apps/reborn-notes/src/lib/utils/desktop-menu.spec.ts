/**
 * The desktop menu has its texts in three places that only meet at runtime:
 * the English fallback in the shell (`src-tauri/src/app_menu.rs`), the keys
 * the page sends (`DESKTOP_MENU_KEYS`) and the translations
 * (`desktop.menu.*`). A key added or renamed in one place only would leave a
 * menu item in English, so the three are compared here, together with the
 * command and event names shared with the shell.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canOpenSettingsFrom,
  DESKTOP_MENU_KEYS,
  DESKTOP_MENU_SETTINGS_EVENT,
  desktopMenuMessageId,
  desktopMenuTexts,
  localizeDesktopMenu,
  onDesktopMenuSettings
} from './desktop-menu';

const rustSource = readFileSync(
  new URL('../../../src-tauri/src/app_menu.rs', import.meta.url),
  'utf8'
);
const enNotes = JSON.parse(
  readFileSync(
    new URL('../../../../../packages/i18n/src/translations/notes/en.json', import.meta.url),
    'utf8'
  )
) as { desktop?: { menu?: Record<string, string> } };

/** `DEFAULT_TEXTS` of app_menu.rs as [key, text] pairs. */
function rustDefaultTexts(): [string, string][] {
  const block = /const DEFAULT_TEXTS[^=]*=\s*&\[([\s\S]*?)\];/.exec(rustSource)?.[1] ?? '';
  return [...block.matchAll(/\("([a-z_]+)",\s*"([^"]*)"\)/g)].map((m) => [m[1], m[2]]);
}

describe('desktop menu contract', () => {
  it('sends exactly the keys the shell knows', () => {
    const rustKeys = rustDefaultTexts().map(([key]) => key);
    expect(rustKeys.length).toBeGreaterThan(0);
    expect([...DESKTOP_MENU_KEYS]).toEqual(rustKeys);
  });

  it('has an English translation equal to the shell fallback for every key', () => {
    expect(Object.fromEntries(rustDefaultTexts())).toEqual(enNotes.desktop?.menu);
  });

  it('shares the command and event names with the shell', () => {
    expect(rustSource).toContain('pub fn desktop_menu_localize(');
    expect(rustSource).toContain(
      `pub const OPEN_SETTINGS_EVENT: &str = "${DESKTOP_MENU_SETTINGS_EVENT}";`
    );
  });
});

describe('desktopMenuTexts', () => {
  it('translates every menu key', () => {
    const texts = desktopMenuTexts((id) => `T(${id})`);
    expect(Object.keys(texts)).toEqual([...DESKTOP_MENU_KEYS]);
    expect(texts.quit).toBe('T(desktop.menu.quit)');
  });

  it('leaves out a key without a translation', () => {
    const texts = desktopMenuTexts((id) => (id === desktopMenuMessageId('zoom') ? id : 'x'));
    expect(texts).not.toHaveProperty('zoom');
    expect(texts.copy).toBe('x');
  });
});

describe('canOpenSettingsFrom', () => {
  it('opens settings from the app screens', () => {
    expect(canOpenSettingsFrom('/', '')).toBe(true);
    expect(canOpenSettingsFrom('/settings', '')).toBe(true);
    expect(canOpenSettingsFrom('/notes/', '/notes')).toBe(true);
  });

  it('not from sign-in, lock or a public share', () => {
    expect(canOpenSettingsFrom('/auth/applock', '')).toBe(false);
    expect(canOpenSettingsFrom('/auth/login', '')).toBe(false);
    expect(canOpenSettingsFrom('/auth/lock', '')).toBe(false);
    expect(canOpenSettingsFrom('/s/abc', '')).toBe(false);
    expect(canOpenSettingsFrom('/notes/auth/unlock', '/notes')).toBe(false);
  });
});

describe('shell calls', () => {
  const globals = globalThis as { __TAURI__?: unknown };
  let invoke: ReturnType<typeof vi.fn>;
  let listen: ReturnType<typeof vi.fn>;
  let unlisten: ReturnType<typeof vi.fn>;
  let emit: ((event: { payload: unknown }) => void) | undefined;

  beforeEach(() => {
    invoke = vi.fn(async () => null);
    unlisten = vi.fn();
    emit = undefined;
    listen = vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
      emit = handler;
      return unlisten;
    });
    globals.__TAURI__ = { core: { invoke }, event: { listen } };
  });

  afterEach(() => {
    delete globals.__TAURI__;
  });

  it('sends the translated texts through desktop_menu_localize', async () => {
    await localizeDesktopMenu((id) => (id === 'desktop.menu.copy' ? 'Kopiuj' : id));
    expect(invoke).toHaveBeenCalledWith('desktop_menu_localize', { texts: { copy: 'Kopiuj' } });
  });

  it('does not reject when the shell refuses', async () => {
    invoke.mockRejectedValueOnce('unknown command');
    await expect(localizeDesktopMenu(() => 'x')).resolves.toBeUndefined();
  });

  it('calls the handler on the Settings event and stops on unsubscribe', async () => {
    const handler = vi.fn();
    const off = onDesktopMenuSettings(handler);
    expect(listen).toHaveBeenCalledWith(DESKTOP_MENU_SETTINGS_EVENT, expect.any(Function));
    await Promise.resolve();

    emit?.({ payload: null });
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('drops a listener that arrives after the unsubscribe', async () => {
    const off = onDesktopMenuSettings(vi.fn());
    off();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('is a no-op outside the shell', () => {
    delete globals.__TAURI__;
    const off = onDesktopMenuSettings(vi.fn());
    expect(() => off()).not.toThrow();
  });
});
