import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALE_NAMES, SUPPORTED_LOCALES } from '../config';
import { readSupportedLocales } from '../../../../scripts/supported-locales.mjs';

/**
 * SUPPORTED_LOCALES (config.ts) is the single source of the locale list
 * (Arabic plan, Phase 2 prep, 2026-11-04). Typed consumers - server string
 * tables, the service worker, LOCALE_NAMES, the translation module map in
 * setup.ts - are `Record<SupportedLocale, ...>` and fail svelte-check / tsc on
 * their own when a locale is added. This spec covers what the type system
 * cannot see: the Node scripts and the files on disk. Adding a locale must
 * touch the list AND ship every file, in one change.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const sorted = (list: readonly string[]) => [...list].sort();

/** Locale codes present in `dir`, as `<code>.json` files or `<code>/` folders. */
function localesIn(dir: string, kind: 'files' | 'dirs'): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true })
    .filter((e) => (kind === 'dirs' ? e.isDirectory() : e.isFile() && e.name.endsWith('.json')))
    .map((e) => e.name.replace(/\.json$/, ''));
}

describe('SUPPORTED_LOCALES - single source', () => {
  it('is what the Node scripts read (check-i18n-parity, export-release-notes)', () => {
    expect(readSupportedLocales()).toEqual([...SUPPORTED_LOCALES]);
  });

  it('starts with the source locale and contains the default', () => {
    // check-i18n-parity compares every locale against the first one.
    expect(SUPPORTED_LOCALES[0]).toBe('en');
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('has a display name for every locale and nothing else', () => {
    expect(sorted(Object.keys(LOCALE_NAMES))).toEqual(sorted(SUPPORTED_LOCALES));
  });

  it.each([
    ['translations/notes', 'files'],
    ['translations/common', 'files'],
    ['translations/tasks', 'dirs'],
    ['release-notes/text', 'files']
  ] as const)('%s ships exactly the supported locales', (dir, kind) => {
    expect(sorted(localesIn(dir, kind))).toEqual(sorted(SUPPORTED_LOCALES));
  });
});
