import { describe, it, expect, vi, beforeEach } from 'vitest';

// core/store imports validateEncryptedPayload at module level; stub the
// browser-only crypto package so the module graph loads in the test env.
vi.mock('@reborn/crypto', () => ({
  validateEncryptedPayload: vi.fn()
}));

import { folderStore, folderOperations } from '../stores/folder.store';
import type { FolderEncrypted } from '@reborn/types';
import type { BatchResult } from '../core/types';

const EMPTY_BATCH: BatchResult = { success: 0, failed: 0, errors: [] };

function makeFolder(overrides: Partial<FolderEncrypted> & { id: string }): FolderEncrypted {
  return {
    user_id: 'user-1',
    name_encrypted: 'aXZfYmFzZTY0XzE2:Y2lwaGVydGV4dA==',
    order_index: 0,
    is_archived: false,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    sync_status: 'synced',
    sync_version: 3,
    ...overrides
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// Regression tests for audit 013 N1: a pull racing a folder reorder could
// revert it, because order_index was written first and sync_status:'pending'
// only afterwards row-by-row (the pull guard skips only already-pending rows).
describe('folderOperations.reorderFolders', () => {
  it('writes order_index and sync_status pending in a single batch', async () => {
    const a = makeFolder({ id: 'a', order_index: 0 });
    const b = makeFolder({ id: 'b', order_index: 1 });
    vi.spyOn(folderStore, 'getMany').mockResolvedValue([a, b]);
    const saveMany = vi
      .spyOn(folderStore, 'saveMany')
      .mockResolvedValue({ ...EMPTY_BATCH, success: 2 });
    const save = vi.spyOn(folderStore, 'save').mockResolvedValue();

    const written = await folderOperations.reorderFolders(null, ['b', 'a']);

    expect(saveMany).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    const rows = saveMany.mock.calls[0]![0] as FolderEncrypted[];
    expect(rows.map((r) => [r.id, r.order_index, r.sync_status])).toEqual([
      ['b', 0, 'pending'],
      ['a', 1, 'pending']
    ]);
    expect(written).toEqual(['b', 'a']);
  });

  it('skips ids deleted remotely mid-gesture and keeps position-derived indexes', async () => {
    const a = makeFolder({ id: 'a' });
    const c = makeFolder({ id: 'c' });
    // 'b' no longer exists locally - getMany silently drops it.
    vi.spyOn(folderStore, 'getMany').mockResolvedValue([a, c]);
    const saveMany = vi
      .spyOn(folderStore, 'saveMany')
      .mockResolvedValue({ ...EMPTY_BATCH, success: 2 });

    const written = await folderOperations.reorderFolders(null, ['c', 'b', 'a']);

    const rows = saveMany.mock.calls[0]![0] as FolderEncrypted[];
    // Indexes match the position in the requested order (what the caller
    // pushes to the server), not a compacted 0..n-1 sequence.
    expect(rows.map((r) => [r.id, r.order_index])).toEqual([
      ['c', 0],
      ['a', 2]
    ]);
    expect(written).toEqual(['c', 'a']);
  });

  it('skips rows reparented away from the sibling group mid-gesture', async () => {
    const a = makeFolder({ id: 'a', parent_id: 'group' });
    const b = makeFolder({ id: 'b', parent_id: 'elsewhere' });
    vi.spyOn(folderStore, 'getMany').mockResolvedValue([a, b]);
    const saveMany = vi
      .spyOn(folderStore, 'saveMany')
      .mockResolvedValue({ ...EMPTY_BATCH, success: 1 });

    const written = await folderOperations.reorderFolders('group', ['b', 'a']);

    const rows = saveMany.mock.calls[0]![0] as FolderEncrypted[];
    expect(rows.map((r) => r.id)).toEqual(['a']);
    expect(rows[0]!.order_index).toBe(1);
    expect(written).toEqual(['a']);
  });

  it('treats undefined parent_id as the root group', async () => {
    const root = makeFolder({ id: 'root-child' }); // parent_id undefined
    vi.spyOn(folderStore, 'getMany').mockResolvedValue([root]);
    const saveMany = vi
      .spyOn(folderStore, 'saveMany')
      .mockResolvedValue({ ...EMPTY_BATCH, success: 1 });

    const written = await folderOperations.reorderFolders(null, ['root-child']);

    expect((saveMany.mock.calls[0]![0] as FolderEncrypted[]).map((r) => r.id)).toEqual([
      'root-child'
    ]);
    expect(written).toEqual(['root-child']);
  });
});

describe('folderOperations.moveFolder', () => {
  it('marks the row pending in the same write as the move', async () => {
    const folder = makeFolder({ id: 'a', parent_id: 'old-parent', order_index: 5 });
    vi.spyOn(folderStore, 'get').mockResolvedValue(folder);
    // New parent group is the root: getRootFolders() -> getAll()
    vi.spyOn(folderStore, 'getAll').mockResolvedValue([]);
    const save = vi.spyOn(folderStore, 'save').mockResolvedValue();

    await folderOperations.moveFolder('a', null);

    expect(save).toHaveBeenCalledTimes(1);
    const row = save.mock.calls[0]![0] as FolderEncrypted;
    expect(row.parent_id).toBeUndefined();
    expect(row.order_index).toBe(0);
    expect(row.sync_status).toBe('pending');
  });
});
