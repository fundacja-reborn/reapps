import { describe, it, expect } from 'vitest';
import type { AppSettings } from '@reborn/storage';
import type { SupportedLocale } from '@reborn/i18n';

/**
 * Single locale list (Arabic plan, Phase 2 prep, 2026-11-04): @reborn/storage
 * does not depend on @reborn/i18n, so `AppSettings['language']` keeps its own
 * literal union. This compile-time check - run by svelte-check, the `check`
 * target in CI - fails as soon as that union drifts from SUPPORTED_LOCALES.
 * The rest of the guard lives in packages/i18n/src/__tests__/supported-locales.spec.ts.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const languageMatchesSupportedLocales: Equal<AppSettings['language'], SupportedLocale> = true;

describe('supported locales - storage type', () => {
  it("AppSettings['language'] is exactly SupportedLocale (checked by svelte-check)", () => {
    expect(languageMatchesSupportedLocales).toBe(true);
  });
});
