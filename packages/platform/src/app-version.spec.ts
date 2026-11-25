import { describe, expect, it } from 'vitest';
import { parseBackendVersion } from './app-version';

describe('parseBackendVersion', () => {
  it('reads the version from a well-formed app-config body', () => {
    expect(parseBackendVersion({ success: true, data: { version: '0.40.0' } })).toBe('0.40.0');
  });

  it('ignores sibling fields (native thresholds)', () => {
    const body = {
      success: true,
      data: { version: '1.2.3', native: { android: { min_build: 5 }, ios: {} } }
    };
    expect(parseBackendVersion(body)).toBe('1.2.3');
  });

  it('returns null when version is missing', () => {
    expect(parseBackendVersion({ success: true, data: { native: {} } })).toBeNull();
  });

  it('returns null for an empty-string version', () => {
    expect(parseBackendVersion({ data: { version: '' } })).toBeNull();
  });

  it('returns null for a non-string version', () => {
    expect(parseBackendVersion({ data: { version: 40 } })).toBeNull();
  });

  it('fails soft on unusable shapes', () => {
    expect(parseBackendVersion(null)).toBeNull();
    expect(parseBackendVersion(undefined)).toBeNull();
    expect(parseBackendVersion('nope')).toBeNull();
    expect(parseBackendVersion({})).toBeNull();
    expect(parseBackendVersion({ data: null })).toBeNull();
  });
});
