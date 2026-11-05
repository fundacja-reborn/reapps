import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  SUPPORTED_LOCALES, 
  DEFAULT_LOCALE, 
  getBrowserLocale,
  saveLocalePreference,
  LOCALE_STORAGE_KEY,
  LOCALE_NAMES,
  BETA_LOCALES,
  localeLabel,
  intlLocale
} from '../config';

describe('i18n config', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Reset navigator.language mock
    vi.restoreAllMocks();
  });

  describe('SUPPORTED_LOCALES', () => {
    it('should include English and Polish', () => {
      expect(SUPPORTED_LOCALES).toContain('en');
      expect(SUPPORTED_LOCALES).toContain('pl');
    });
  });

  describe('DEFAULT_LOCALE', () => {
    it('should be English', () => {
      expect(DEFAULT_LOCALE).toBe('en');
    });
  });

  describe('getBrowserLocale', () => {
    it('should return stored locale if available', () => {
      localStorage.setItem(LOCALE_STORAGE_KEY, 'pl');
      expect(getBrowserLocale()).toBe('pl');
    });

    it('should return browser locale if supported', () => {
      Object.defineProperty(navigator, 'language', {
        value: 'pl-PL',
        configurable: true
      });
      expect(getBrowserLocale()).toBe('pl');
    });

    it('should return default locale if browser locale is not supported', () => {
      Object.defineProperty(navigator, 'language', {
        value: 'ja-JP',
        configurable: true
      });
      expect(getBrowserLocale()).toBe(DEFAULT_LOCALE);
    });

    it('should return default locale if no preference is set', () => {
      Object.defineProperty(navigator, 'language', {
        value: '',
        configurable: true
      });
      expect(getBrowserLocale()).toBe(DEFAULT_LOCALE);
    });
  });

  describe('saveLocalePreference', () => {
    it('should save locale to localStorage', () => {
      saveLocalePreference('pl');
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
    });
  });

  describe('intlLocale', () => {
    it('pins Arabic to Western digits', () => {
      expect(intlLocale('ar')).toBe('ar-u-nu-latn');
      expect(intlLocale('ar-EG')).toBe('ar-EG-u-nu-latn');
      expect(new Intl.NumberFormat(intlLocale('ar-EG')).format(1234)).toMatch(/^1.?234$/);
      expect(
        new Intl.DateTimeFormat(intlLocale('ar-SA'), { day: 'numeric', timeZone: 'UTC' }).format(
          new Date(Date.UTC(2026, 10, 5))
        )
      ).toMatch(/5/);
    });

    it('keeps supported tags and an explicit extension as they are', () => {
      expect(intlLocale('pl')).toBe('pl');
      expect(intlLocale('pl-PL')).toBe('pl-PL');
      expect(intlLocale('en-US')).toBe('en-US');
      expect(intlLocale('ar-u-nu-arab')).toBe('ar-u-nu-arab');
    });

    it('falls back to the default locale for anything else', () => {
      for (const value of ['xx', 'uk', '', null, undefined, 42]) {
        expect(intlLocale(value), String(value)).toBe(DEFAULT_LOCALE);
      }
    });
  });

  describe('localeLabel', () => {
    it('marks beta locales and leaves the others as their native name', () => {
      for (const l of SUPPORTED_LOCALES) {
        const expected = BETA_LOCALES.includes(l) ? `${LOCALE_NAMES[l]} (beta)` : LOCALE_NAMES[l];
        expect(localeLabel(l)).toBe(expected);
      }
      expect(localeLabel('ar')).toBe(`${LOCALE_NAMES.ar} (beta)`);
      expect(localeLabel('en')).toBe('English');
    });
  });
});
