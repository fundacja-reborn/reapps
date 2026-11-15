import { describe, it, expect } from 'vitest';
import {
  WEB_LOCK_DEFAULT_TIMEOUT_MS,
  WEB_LOCK_TIMEOUT_NEVER,
  WEB_LOCK_TIMEOUT_PRESETS_MS,
  isWebLockIdleExpired,
  normalizeWebLockTimeout,
  parseStoredTimestamp
} from '../web-lock';

describe('web-lock policy', () => {
  describe('normalizeWebLockTimeout', () => {
    it('keeps every preset, including "never"', () => {
      for (const preset of WEB_LOCK_TIMEOUT_PRESETS_MS) {
        expect(normalizeWebLockTimeout(preset)).toBe(preset);
      }
      expect(WEB_LOCK_TIMEOUT_PRESETS_MS).toContain(WEB_LOCK_TIMEOUT_NEVER);
      expect(WEB_LOCK_TIMEOUT_PRESETS_MS).toContain(WEB_LOCK_DEFAULT_TIMEOUT_MS);
    });

    it('falls back to the default for anything else', () => {
      for (const value of [1, -1, 999_999_999, '60000', null, undefined, Number.NaN]) {
        expect(normalizeWebLockTimeout(value)).toBe(WEB_LOCK_DEFAULT_TIMEOUT_MS);
      }
    });

    it('offers no "immediately" preset', () => {
      const positive = WEB_LOCK_TIMEOUT_PRESETS_MS.filter((ms) => ms > 0);
      expect(Math.min(...positive)).toBeGreaterThanOrEqual(60_000);
    });
  });

  describe('isWebLockIdleExpired', () => {
    const T = 1_700_000_000_000;

    it('expires exactly at the timeout', () => {
      expect(isWebLockIdleExpired(T + 59_999, T, 60_000)).toBe(false);
      expect(isWebLockIdleExpired(T + 60_000, T, 60_000)).toBe(true);
    });

    it('never expires with the "never" preset', () => {
      expect(isWebLockIdleExpired(T + 10 * 24 * 3600_000, T, WEB_LOCK_TIMEOUT_NEVER)).toBe(false);
    });

    it('tolerates a small clock correction but locks on a large rollback', () => {
      expect(isWebLockIdleExpired(T - 5_000, T, 60_000)).toBe(false);
      expect(isWebLockIdleExpired(T - 3600_000, T, 60_000)).toBe(true);
    });
  });

  describe('parseStoredTimestamp', () => {
    it('reads a stored epoch and treats junk as "never"', () => {
      expect(parseStoredTimestamp('1700000000000')).toBe(1_700_000_000_000);
      for (const raw of [null, undefined, '', 'abc', '-5', '0']) {
        expect(parseStoredTimestamp(raw)).toBe(0);
      }
    });
  });
});
