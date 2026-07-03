import { describe, it, expect, vi, beforeEach } from 'vitest';

// core/store imports validateEncryptedPayload at module level; stub the
// browser-only crypto package so the module graph loads in the test env.
vi.mock('@reborn/crypto', () => ({
  validateEncryptedPayload: vi.fn()
}));

import { folderStore, folderQueries } from '../stores/folder.store';
import type { FolderEncrypted } from '@reborn/types';

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

// Regression tests for audit 013 N2 hardening: sync can briefly land a
// parent_id cycle (concurrent cross-device moves; repaired at pull). The
// breadcrumb walk must terminate on it instead of hanging the tab.
describe('folderQueries.getFolderPath', () => {
  it('walks a healthy chain root-first', async () => {
    const rows = new Map([
      ['root', makeFolder({ id: 'root' })],
      ['mid', makeFolder({ id: 'mid', parent_id: 'root' })],
      ['leaf', makeFolder({ id: 'leaf', parent_id: 'mid' })]
    ]);
    vi.spyOn(folderStore, 'get').mockImplementation(async (id: string) => rows.get(id) ?? null);

    const path = await folderQueries.getFolderPath('leaf');

    expect(path.map((p) => p.id)).toEqual(['root', 'mid', 'leaf']);
  });

  it('terminates on a parent_id cycle instead of looping forever', async () => {
    const rows = new Map([
      ['a', makeFolder({ id: 'a', parent_id: 'b' })],
      ['b', makeFolder({ id: 'b', parent_id: 'a' })]
    ]);
    const get = vi
      .spyOn(folderStore, 'get')
      .mockImplementation(async (id: string) => rows.get(id) ?? null);

    const path = await folderQueries.getFolderPath('a');

    // Each member is visited exactly once; the second visit of 'a' is refused.
    expect(path.map((p) => p.id)).toEqual(['b', 'a']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('terminates on a direct self-parent row', async () => {
    const rows = new Map([['a', makeFolder({ id: 'a', parent_id: 'a' })]]);
    vi.spyOn(folderStore, 'get').mockImplementation(async (id: string) => rows.get(id) ?? null);

    const path = await folderQueries.getFolderPath('a');

    expect(path.map((p) => p.id)).toEqual(['a']);
  });
});
