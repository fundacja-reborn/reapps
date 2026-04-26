import { describe, it, expect } from 'vitest';
import {
  shouldRestoreFromTrash,
  shouldRelinkToBackupFolder
} from './export-import-trash-utils';

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

describe('shouldRelinkToBackupFolder', () => {
  const T_OLDER = '2026-04-20T10:00:00Z';
  const T_NEWER = '2026-04-25T10:00:00Z';

  it('returns true when local is newer, sits at root, and backup folder is being restored', () => {
    const restored = new Set(['folder-A']);
    expect(
      shouldRelinkToBackupFolder(
        { folder_id: null, updated_at: T_NEWER },
        { folder_id: 'folder-A', updated_at: T_OLDER },
        restored
      )
    ).toBe(true);
  });

  it('returns false when local folder_id matches backup (nothing to relink)', () => {
    const restored = new Set(['folder-A']);
    expect(
      shouldRelinkToBackupFolder(
        { folder_id: 'folder-A', updated_at: T_NEWER },
        { folder_id: 'folder-A', updated_at: T_OLDER },
        restored
      )
    ).toBe(false);
  });

  it("returns false when backup's folder is NOT being restored/created (deliberate move into a still-living folder)", () => {
    const restored = new Set<string>(); // backup folder unchanged locally
    expect(
      shouldRelinkToBackupFolder(
        { folder_id: null, updated_at: T_NEWER },
        { folder_id: 'folder-A', updated_at: T_OLDER },
        restored
      )
    ).toBe(false);
  });

  it('returns false when backup is newer (full-import path will overwrite folder_id anyway)', () => {
    const restored = new Set(['folder-A']);
    expect(
      shouldRelinkToBackupFolder(
        { folder_id: null, updated_at: T_OLDER },
        { folder_id: 'folder-A', updated_at: T_NEWER },
        restored
      )
    ).toBe(false);
  });

  it('returns false when local is archived AND backup is active (full restore-from-trash takes over)', () => {
    const restored = new Set(['folder-A']);
    expect(
      shouldRelinkToBackupFolder(
        { folder_id: null, updated_at: T_NEWER, is_archived: true },
        { folder_id: 'folder-A', updated_at: T_OLDER, is_archived: false },
        restored
      )
    ).toBe(false);
  });

  it('returns false when backup folder_id is null/undefined (no anchor to relink to)', () => {
    const restored = new Set(['folder-A']);
    expect(
      shouldRelinkToBackupFolder(
        { folder_id: 'folder-A', updated_at: T_NEWER },
        { folder_id: null, updated_at: T_OLDER },
        restored
      )
    ).toBe(false);
    expect(
      shouldRelinkToBackupFolder(
        { folder_id: 'folder-A', updated_at: T_NEWER },
        { updated_at: T_OLDER },
        restored
      )
    ).toBe(false);
  });

  it('returns false when existing is null/undefined (brand new note from backup)', () => {
    const restored = new Set(['folder-A']);
    expect(
      shouldRelinkToBackupFolder(null, { folder_id: 'folder-A', updated_at: T_OLDER }, restored)
    ).toBe(false);
    expect(
      shouldRelinkToBackupFolder(
        undefined,
        { folder_id: 'folder-A', updated_at: T_OLDER },
        restored
      )
    ).toBe(false);
  });

  it('returns true when timestamps are equal (local "newer" guard is >=, treat as local-wins for content)', () => {
    const restored = new Set(['folder-A']);
    expect(
      shouldRelinkToBackupFolder(
        { folder_id: null, updated_at: T_OLDER },
        { folder_id: 'folder-A', updated_at: T_OLDER },
        restored
      )
    ).toBe(true);
  });
});
