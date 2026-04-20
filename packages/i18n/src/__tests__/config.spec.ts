import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  SUPPORTED_LOCALES, 
  DEFAULT_LOCALE, 
  getBrowserLocale,
  saveLocalePreference,
  LOCALE_STORAGE_KEY
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
});
