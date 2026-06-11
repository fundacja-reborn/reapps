import { describe, expect, it } from 'vitest';
import {
  defaultStoreUrl,
  evaluateUpdateSeverity,
  parseAppConfig,
  type NativeUpdateConfig
} from './app-update';

const body = (android: Record<string, unknown>, ios: Record<string, unknown> = {}) => ({
  success: true,
  data: { native: { android, ios } }
});

describe('parseAppConfig', () => {
  it('parses a well-formed platform entry', () => {
    const parsed = parseAppConfig(
      body({ min_build: 3, recommended_build: 5, store_url: 'https://example.com/x' }),
      'android'
    );
    expect(parsed).toEqual({
      minBuild: 3,
      recommendedBuild: 5,
      storeUrl: 'https://example.com/x'
    });
  });

  it('picks the requested platform', () => {
    const parsed = parseAppConfig(
      body({ min_build: 3 }, { min_build: 7, recommended_build: 9, store_url: null }),
      'ios'
    );
    expect(parsed).toEqual({ minBuild: 7, recommendedBuild: 9, storeUrl: null });
  });

  it('normalizes missing/invalid fields to "no enforcement"', () => {
    const parsed = parseAppConfig(
      body({ min_build: '3', recommended_build: -1, store_url: '' }),
      'android'
    );
    expect(parsed).toEqual({ minBuild: 0, recommendedBuild: 0, storeUrl: null });
  });

  it.each([
    ['null body', null],
    ['non-object body', 'nope'],
    ['missing data', { success: true }],
    ['missing native', { data: {} }],
    ['missing platform entry', { data: { native: { ios: {} } } }]
  ])('returns null (fail-open) for %s', (_label, malformed) => {
    expect(parseAppConfig(malformed, 'android')).toBeNull();
  });
});

describe('evaluateUpdateSeverity', () => {
  const config = (minBuild: number, recommendedBuild: number): NativeUpdateConfig => ({
    minBuild,
    recommendedBuild,
    storeUrl: null
  });

  it('returns required below min_build', () => {
    expect(evaluateUpdateSeverity(2, config(3, 0))).toBe('required');
  });

  it('returns ok at exactly min_build', () => {
    expect(evaluateUpdateSeverity(3, config(3, 0))).toBe('ok');
  });

  it('returns recommended below recommended_build (and above min)', () => {
    expect(evaluateUpdateSeverity(4, config(3, 5))).toBe('recommended');
  });

  it('required wins over recommended', () => {
    expect(evaluateUpdateSeverity(2, config(3, 5))).toBe('required');
  });

  it('returns ok when nothing is enforced (0/0)', () => {
    expect(evaluateUpdateSeverity(1, config(0, 0))).toBe('ok');
  });

  it.each([0, -1, Number.NaN, 1.5])('fails open for unusable current build %s', (build) => {
    expect(evaluateUpdateSeverity(build, config(99, 99))).toBe('ok');
  });
});

describe('defaultStoreUrl', () => {
  it('derives the Play listing from the package id on android', () => {
    expect(defaultStoreUrl('android', 'eu.reapps.notes')).toBe(
      'https://play.google.com/store/apps/details?id=eu.reapps.notes'
    );
  });

  it('returns null on ios (numeric store id unknowable client-side)', () => {
    expect(defaultStoreUrl('ios', 'eu.reapps.notes')).toBeNull();
  });

  it('returns null for an empty app id', () => {
    expect(defaultStoreUrl('android', '')).toBeNull();
  });
});
