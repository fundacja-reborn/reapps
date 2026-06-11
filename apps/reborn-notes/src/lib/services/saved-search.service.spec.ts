import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SavedSearchEncrypted } from '@reborn/types';

const rows: SavedSearchEncrypted[] = [];
const saveSpy = vi.fn();
const deleteSpy = vi.fn();
const pushSpy = vi.fn();
const pushUpdateSpy = vi.fn();
const pushDeleteSpy = vi.fn();

vi.mock('@reborn/crypto', () => ({
  cryptoManager: {
    isInitialized: () => true,
    encryptText: async (value: string) => `enc:${value}`,
    decryptText: async (stored: string) => stored.replace(/^enc:/, '')
  }
}));

vi.mock('@reborn/storage', () => ({
  savedSearchStore: {
    get: async (id: string) => rows.find((r) => r.id === id) ?? null,
    getAll: async () => [...rows],
    save: async (row: SavedSearchEncrypted) => {
      saveSpy(row);
      const idx = rows.findIndex((r) => r.id === row.id);
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
    },
    delete: async (id: string) => {
      deleteSpy(id);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
    }
  },
  savedSearchQueries: {
    getNextPosition: async () =>
      rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.position)) + 1
  }
}));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ userId: 'user-1', isAuthenticated: true }) };
});

vi.mock('./notes-sync.service', () => ({
  pushSavedSearch: (...args: unknown[]) => pushSpy(...args),
  pushSavedSearchUpdate: (...args: unknown[]) => pushUpdateSpy(...args),
  pushSavedSearchDelete: (...args: unknown[]) => pushDeleteSpy(...args)
}));

const {
  createSavedSearch,
  getAllSavedSearches,
  renameSavedSearch,
  moveSavedSearchToFolder,
  deleteSavedSearch
} = await import('./saved-search.service');

function seed(partial: Partial<SavedSearchEncrypted> & { id: string }): SavedSearchEncrypted {
  const row: SavedSearchEncrypted = {
    user_id: 'user-1',
    name_encrypted: 'enc:Seeded',
    query_encrypted: 'enc:tag:x',
    position: 0,
    sync_version: 1,
    sync_status: 'synced',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...partial
  };
  rows.push(row);
  return row;
}

beforeEach(() => {
  rows.length = 0;
  saveSpy.mockReset();
  deleteSpy.mockReset();
  pushSpy.mockReset();
  pushUpdateSpy.mockReset();
  pushDeleteSpy.mockReset();
});

describe('createSavedSearch', () => {
  it('encrypts name and query, appends position, saves pending and pushes', async () => {
    seed({ id: 's-0', position: 4 });

    const id = await createSavedSearch('  German Cars  ', ' folder:Cars tag:DE ');

    const created = rows.find((r) => r.id === id)!;
    expect(created.name_encrypted).toBe('enc:German Cars');
    expect(created.query_encrypted).toBe('enc:folder:Cars tag:DE');
    expect(created.position).toBe(5);
    expect(created.sync_status).toBe('pending');
    expect(created.sync_version).toBe(0);
    expect(created.user_id).toBe('user-1');
    expect(created.folder_id).toBeUndefined();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ id, position: 5 }));
  });

  it('rejects empty name or query', async () => {
    await expect(createSavedSearch('   ', 'tag:x')).rejects.toThrow();
    await expect(createSavedSearch('Name', '   ')).rejects.toThrow();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

describe('getAllSavedSearches', () => {
  it('decrypts and sorts by position, then name', async () => {
    seed({ id: 'b', position: 1, name_encrypted: 'enc:Beta' });
    seed({ id: 'c', position: 0, name_encrypted: 'enc:Zeta' });
    seed({ id: 'a', position: 0, name_encrypted: 'enc:Alpha' });

    const all = await getAllSavedSearches();

    expect(all.map((s) => s.name)).toEqual(['Alpha', 'Zeta', 'Beta']);
    expect(all[0]!.query).toBe('tag:x');
  });
});

describe('renameSavedSearch', () => {
  it('re-encrypts the name, marks pending and pushes only the name field', async () => {
    seed({ id: 's-1' });

    await renameSavedSearch('s-1', ' New Name ');

    const updated = rows.find((r) => r.id === 's-1')!;
    expect(updated.name_encrypted).toBe('enc:New Name');
    expect(updated.sync_status).toBe('pending');
    expect(pushUpdateSpy).toHaveBeenCalledWith('s-1', { name_encrypted: 'enc:New Name' });
  });
});

describe('moveSavedSearchToFolder', () => {
  it('parks the search in a folder and pushes the FK', async () => {
    seed({ id: 's-1' });

    await moveSavedSearchToFolder('s-1', 'folder-9');

    const updated = rows.find((r) => r.id === 's-1')!;
    expect(updated.folder_id).toBe('folder-9');
    expect(updated.sync_status).toBe('pending');
    expect(pushUpdateSpy).toHaveBeenCalledWith('s-1', { folder_id: 'folder-9' });
  });

  it('unparks with null and drops the folder_id key entirely', async () => {
    seed({ id: 's-1', folder_id: 'folder-9' });

    await moveSavedSearchToFolder('s-1', null);

    const updated = rows.find((r) => r.id === 's-1')!;
    expect('folder_id' in updated).toBe(false);
    expect(pushUpdateSpy).toHaveBeenCalledWith('s-1', { folder_id: null });
  });
});

describe('deleteSavedSearch', () => {
  it('hard-deletes locally and pushes the delete', async () => {
    seed({ id: 's-1' });

    await deleteSavedSearch('s-1');

    expect(rows).toHaveLength(0);
    expect(deleteSpy).toHaveBeenCalledWith('s-1');
    expect(pushDeleteSpy).toHaveBeenCalledWith('s-1');
  });
});
