import { describe, it, expect } from 'vitest';
import {
  LOCAL_PASSCODE_MIN_LENGTH,
  LOCAL_PASSCODE_FREE_ATTEMPTS,
  LOCAL_PASSCODE_MAX_DELAY_MS,
  localPasscodeRetryDelayMs,
  isTriviallyGuessablePasscode,
  LocalPasscodeThrottledError
} from '../local-passcode';

describe('local passcode policy (audit 012 N6)', () => {
  describe('localPasscodeRetryDelayMs', () => {
    it('gives no delay for the free attempts', () => {
      for (let count = 0; count < LOCAL_PASSCODE_FREE_ATTEMPTS; count++) {
        expect(localPasscodeRetryDelayMs(count)).toBe(0);
      }
    });

    it('starts at 10 s and doubles per failure', () => {
      expect(localPasscodeRetryDelayMs(LOCAL_PASSCODE_FREE_ATTEMPTS)).toBe(10_000);
      expect(localPasscodeRetryDelayMs(LOCAL_PASSCODE_FREE_ATTEMPTS + 1)).toBe(20_000);
      expect(localPasscodeRetryDelayMs(LOCAL_PASSCODE_FREE_ATTEMPTS + 2)).toBe(40_000);
    });

    it('caps at 15 minutes and survives absurd counts without overflow', () => {
      expect(localPasscodeRetryDelayMs(50)).toBe(LOCAL_PASSCODE_MAX_DELAY_MS);
      expect(localPasscodeRetryDelayMs(10_000)).toBe(LOCAL_PASSCODE_MAX_DELAY_MS);
    });
  });

  describe('isTriviallyGuessablePasscode', () => {
    it('flags repeated single characters', () => {
      expect(isTriviallyGuessablePasscode('111111')).toBe(true);
      expect(isTriviallyGuessablePasscode('aaaaaa')).toBe(true);
    });

    it('flags straight runs in both directions', () => {
      expect(isTriviallyGuessablePasscode('123456')).toBe(true);
      expect(isTriviallyGuessablePasscode('987654')).toBe(true);
      expect(isTriviallyGuessablePasscode('abcdef')).toBe(true);
    });

    it('accepts ordinary passcodes', () => {
      expect(isTriviallyGuessablePasscode('correct horse')).toBe(false);
      expect(isTriviallyGuessablePasscode('a1b2c3')).toBe(false);
      // Known limitation, documented on the helper: alternating patterns pass.
      expect(isTriviallyGuessablePasscode('121212')).toBe(false);
    });
  });

  it('exposes the shared minimum the UIs and crypto layer both enforce', () => {
    expect(LOCAL_PASSCODE_MIN_LENGTH).toBe(6);
  });

  it('LocalPasscodeThrottledError carries the remaining wait', () => {
    const err = new LocalPasscodeThrottledError(12_345);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LocalPasscodeThrottledError');
    expect(err.retryAfterMs).toBe(12_345);
  });
});
