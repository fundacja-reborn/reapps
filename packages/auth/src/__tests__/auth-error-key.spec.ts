import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_KEYS, authErrorKey } from '../utils/auth-error-key';

const COMMON_LOCALES = ['en', 'pl', 'de', 'fr', 'es', 'ar'];
const catalog = (locale: string) =>
  JSON.parse(
    readFileSync(
      resolve(__dirname, `../../../i18n/src/translations/common/${locale}.json`),
      'utf-8'
    )
  );
const lookup = (obj: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

describe('authErrorKey', () => {
  it('maps the server texts the auth routes send to translation keys', () => {
    const fallback = 'auth.login.errors.server_error';
    expect(authErrorKey('Invalid credentials', fallback)).toBe(
      'auth.login.errors.invalid_credentials'
    );
    expect(authErrorKey('Account temporarily locked. Too many failed attempts.', fallback)).toBe(
      'auth.login.errors.account_locked'
    );
    expect(authErrorKey('Too many requests. Please try again later.', fallback)).toBe(
      'auth.login.errors.too_many_requests'
    );
    expect(authErrorKey('Username already taken', fallback)).toBe(
      'auth.register.errors.user_already_exists'
    );
  });

  it('falls back to the action text for anything else, never the server text', () => {
    expect(authErrorKey('Internal server error', 'auth.register.errors.server_error')).toBe(
      'auth.register.errors.server_error'
    );
    expect(authErrorKey(undefined, 'auth.login.errors.server_error')).toBe(
      'auth.login.errors.server_error'
    );
    expect(authErrorKey({ error: 'x' }, 'auth.login.errors.server_error')).toBe(
      'auth.login.errors.server_error'
    );
  });

  it.each(COMMON_LOCALES)('returns only keys the %s common catalog has', (locale) => {
    const json = catalog(locale);
    for (const key of AUTH_ERROR_KEYS) expect(typeof lookup(json, key), key).toBe('string');
  });
});
