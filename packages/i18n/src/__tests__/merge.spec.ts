import { describe, it, expect } from 'vitest';
import { mergeTranslations } from '../setup';

describe('mergeTranslations', () => {
  it('overwrites primitive leaves with source values', () => {
    const target: Record<string, any> = { hello: 'common-hi', count: 1 };
    mergeTranslations(target, { hello: 'app-hi', count: 2 });
    expect(target).toEqual({ hello: 'app-hi', count: 2 });
  });

  it('preserves keys present only in target', () => {
    const target: Record<string, any> = { onlyTarget: 'keep' };
    mergeTranslations(target, { onlySource: 'add' });
    expect(target).toEqual({ onlyTarget: 'keep', onlySource: 'add' });
  });

  it('merges nested objects deeply instead of replacing them (regression: ReAuthModal TOTP keys)', () => {
    // Mirrors the Task app load order: common first, then tasks/<loc>/auth.json.
    // The shallow merge bug used to wipe auth.session.totp_* defined only in common.
    const target: Record<string, any> = {
      auth: {
        session: {
          reauth_title: 'Session expired',
          totp_title: 'Two-factor verification',
          totp_label: '2FA code',
          use_recovery: 'Use a recovery code'
        }
      }
    };
    const source = {
      auth: {
        session: {
          reauth_title: 'Session expired (task)',
          submitting: 'Logging in…'
        }
      }
    };

    mergeTranslations(target, source);

    expect(target.auth.session).toEqual({
      reauth_title: 'Session expired (task)',
      totp_title: 'Two-factor verification',
      totp_label: '2FA code',
      use_recovery: 'Use a recovery code',
      submitting: 'Logging in…'
    });
  });

  it('replaces arrays entirely instead of element-wise merging', () => {
    const target: Record<string, any> = { items: ['a', 'b', 'c'] };
    mergeTranslations(target, { items: ['x'] });
    expect(target.items).toEqual(['x']);
  });

  it('overwrites object with primitive and vice versa', () => {
    const target: Record<string, any> = { mixed: { inner: 1 }, swapped: 'hello' };
    mergeTranslations(target, { mixed: 'replaced', swapped: { now: 'object' } });
    expect(target.mixed).toBe('replaced');
    expect(target.swapped).toEqual({ now: 'object' });
  });

  it('handles null source values by overwriting target leaf', () => {
    const target: Record<string, any> = { key: { inner: 'val' } };
    mergeTranslations(target, { key: null });
    expect(target.key).toBeNull();
  });

  it('skips __proto__, constructor, and prototype to prevent prototype pollution', () => {
    // Object.keys(JSON.parse('{"__proto__":{"polluted":true}}')) returns
    // ['__proto__'] as an own property — without the guard this would mutate
    // Object.prototype globally.
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"constructor":"x","prototype":"y","safe":"ok"}');
    const target: Record<string, any> = {};
    mergeTranslations(target, malicious);

    expect(target.safe).toBe('ok');
    expect(target.constructor).toBe(Object); // not overwritten
    expect((target as any).polluted).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined(); // prototype not polluted
    expect(Object.prototype.hasOwnProperty.call(target, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(target, 'prototype')).toBe(false);
  });
});
