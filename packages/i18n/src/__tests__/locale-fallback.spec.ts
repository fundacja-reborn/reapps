import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { locale } from 'svelte-i18n';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isSupportedLocale,
  resolveLocale
} from '../config';
import { changeLocale } from '../setup';

// The `language` setting is synced across devices and apps, so a newer client
// can write a locale this build does not ship. Reading it must never throw,
// switch the UI to a fallback, or persist anything - otherwise app-settings
// init pushes the fallback back and overwrites the user's choice everywhere.

describe('isSupportedLocale', () => {
  it('accepts every shipped locale', () => {
    for (const code of ['en', 'pl', 'de', 'es', 'fr']) {
      expect(isSupportedLocale(code)).toBe(true);
    }
  });

  it('rejects unknown codes, region tags and non-strings', () => {
    for (const value of ['ar', 'xx', 'en-US', 'PL', '', null, undefined, 42, {}]) {
      expect(isSupportedLocale(value)).toBe(false);
    }
  });
});

describe('resolveLocale', () => {
  it('returns the preference when supported', () => {
    expect(resolveLocale('de', 'pl')).toBe('de');
  });

  it('falls back to the current locale for an unsupported preference', () => {
    expect(resolveLocale('ar', 'pl')).toBe('pl');
  });

  it('falls back to the default locale when neither is supported', () => {
    expect(resolveLocale('ar', 'xx')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, null)).toBe(DEFAULT_LOCALE);
  });
});

describe('changeLocale with an unsupported locale', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    locale.set('pl');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'pl');
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('does not throw and reports that nothing was applied', async () => {
    await expect(changeLocale('ar')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('keeps the current locale and leaves the stored preference untouched', async () => {
    await changeLocale('ar');
    expect(get(locale)).toBe('pl');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
  });

  it('still applies and persists a supported locale', async () => {
    await expect(changeLocale('de')).resolves.toBe(true);
    expect(get(locale)).toBe('de');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');
  });
});
