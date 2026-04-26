import { describe, it, expect } from 'vitest';
import { shouldRestoreFromTrash } from './export-import-trash-utils';

describe('shouldRestoreFromTrash', () => {
  it('returns true when local is archived and backup is active', () => {
    expect(
      shouldRestoreFromTrash({ is_archived: true }, { is_archived: false })
    ).toBe(true);
  });

  it('returns false when both sides are active', () => {
    expect(
      shouldRestoreFromTrash({ is_archived: false }, { is_archived: false })
    ).toBe(false);
  });

  it('returns false when both sides are archived', () => {
    expect(
      shouldRestoreFromTrash({ is_archived: true }, { is_archived: true })
    ).toBe(false);
  });

  it('returns false when local is active and backup is archived (do not silently delete newer local edits)', () => {
    expect(
      shouldRestoreFromTrash({ is_archived: false }, { is_archived: true })
    ).toBe(false);
  });

  it('treats missing is_archived on incoming as active (restores local trash)', () => {
    expect(shouldRestoreFromTrash({ is_archived: true }, {})).toBe(true);
  });

  it('treats null is_archived on incoming as active (restores local trash)', () => {
    expect(
      shouldRestoreFromTrash({ is_archived: true }, { is_archived: null })
    ).toBe(true);
  });

  it('returns false for legacy local entity without is_archived field', () => {
    expect(shouldRestoreFromTrash({}, { is_archived: false })).toBe(false);
  });

  it('returns false when existing is undefined (new import, nothing to restore)', () => {
    expect(shouldRestoreFromTrash(undefined, { is_archived: false })).toBe(false);
  });

  it('returns false when existing is null (IndexedDB get() miss)', () => {
    expect(shouldRestoreFromTrash(null, { is_archived: false })).toBe(false);
  });
});
