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
    decryptText: async (stored: string) => stored.replace(/^enc:/, ''),
    encryptObject: async (value: unknown) => `encobj:${JSON.stringify(value)}`,
    decryptObject: async (stored: string) => JSON.parse(stored.replace(/^encobj:/, ''))
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
  pinSavedSearchToRoot,
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

    const id = await createSavedSearch('  Urgent projects  ', ' folder:projects tag:urgent ', false);

    const created = rows.find((r) => r.id === id)!;
    expect(created.name_encrypted).toBe('enc:Urgent projects');
    expect(created.query_encrypted).toBe('enc:folder:projects tag:urgent');
    expect(created.position).toBe(5);
    expect(created.sync_status).toBe('pending');
    expect(created.sync_version).toBe(0);
    expect(created.user_id).toBe('user-1');
    expect(created.folder_id).toBeUndefined();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ id, position: 5 }));
  });

  it('stores the content-toggle in the encrypted metadata bundle - for BOTH states', async () => {
    // Always-present ciphertext: a bundle that only exists when the toggle is
    // on would leak the toggle state to the server through its mere presence.
    const idOn = await createSavedSearch('With content', '"some phrase"', true);
    const idOff = await createSavedSearch('Titles only', 'tag:x', false);

    const withContent = rows.find((r) => r.id === idOn)!;
    const titlesOnly = rows.find((r) => r.id === idOff)!;
    // New searches are never pinned, so the bundle carries pinned_to_root: false.
    expect(withContent.metadata_encrypted).toBe(
      'encobj:{"search_in_content":true,"pinned_to_root":false}'
    );
    expect(titlesOnly.metadata_encrypted).toBe(
      'encobj:{"search_in_content":false,"pinned_to_root":false}'
    );
  });

  it('rejects empty name or query', async () => {
    await expect(createSavedSearch('   ', 'tag:x', false)).rejects.toThrow();
    await expect(createSavedSearch('Name', '   ', false)).rejects.toThrow();
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

  it('round-trips search_in_content and defaults to false for missing/corrupt metadata', async () => {
    seed({ id: 'on', metadata_encrypted: 'encobj:{"search_in_content":true}' });
    seed({ id: 'off', metadata_encrypted: 'encobj:{"search_in_content":false}' });
    seed({ id: 'legacy' }); // no metadata bundle at all
    seed({ id: 'corrupt', metadata_encrypted: 'encobj:not-json' });

    const all = await getAllSavedSearches();
    const byId = new Map(all.map((s) => [s.id, s.search_in_content]));

    expect(byId.get('on')).toBe(true);
    expect(byId.get('off')).toBe(false);
    expect(byId.get('legacy')).toBe(false);
    expect(byId.get('corrupt')).toBe(false);
  });

  it('derives pinned_to_root from metadata, with folder_id winning over the flag', async () => {
    seed({ id: 'root', metadata_encrypted: 'encobj:{"pinned_to_root":true}' });
    // Both set (legacy/inconsistent row): folder-pin wins, never shown at root.
    seed({
      id: 'both',
      folder_id: 'f1',
      metadata_encrypted: 'encobj:{"pinned_to_root":true}'
    });
    seed({ id: 'plain' }); // no metadata
    seed({ id: 'flag-false', metadata_encrypted: 'encobj:{"pinned_to_root":false}' });

    const all = await getAllSavedSearches();
    const byId = new Map(all.map((s) => [s.id, s.pinned_to_root]));

    expect(byId.get('root')).toBe(true);
    expect(byId.get('both')).toBe(false);
    expect(byId.get('plain')).toBe(false);
    expect(byId.get('flag-false')).toBe(false);
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

  it('pinning to a folder clears an existing root-pin and pushes the new bundle', async () => {
    seed({
      id: 's-1',
      metadata_encrypted: 'encobj:{"search_in_content":false,"pinned_to_root":true}'
    });

    await moveSavedSearchToFolder('s-1', 'folder-9');

    const updated = rows.find((r) => r.id === 's-1')!;
    expect(updated.folder_id).toBe('folder-9');
    expect(updated.metadata_encrypted).toBe(
      'encobj:{"search_in_content":false,"pinned_to_root":false}'
    );
    expect(pushUpdateSpy).toHaveBeenCalledWith('s-1', {
      folder_id: 'folder-9',
      metadata_encrypted: 'encobj:{"search_in_content":false,"pinned_to_root":false}'
    });
  });

  it('does not re-encode metadata when the root flag is unchanged (folder-pin churn-free)', async () => {
    seed({
      id: 's-1',
      metadata_encrypted: 'encobj:{"search_in_content":true,"pinned_to_root":false}'
    });

    await moveSavedSearchToFolder('s-1', 'folder-9');

    const updated = rows.find((r) => r.id === 's-1')!;
    // Bundle untouched, and metadata_encrypted stays out of the PATCH payload.
    expect(updated.metadata_encrypted).toBe(
      'encobj:{"search_in_content":true,"pinned_to_root":false}'
    );
    expect(pushUpdateSpy).toHaveBeenCalledWith('s-1', { folder_id: 'folder-9' });
  });
});

describe('pinSavedSearchToRoot', () => {
  it('sets the root flag, clears the folder, and pushes bundle + null folder_id', async () => {
    seed({
      id: 's-1',
      folder_id: 'folder-9',
      metadata_encrypted: 'encobj:{"search_in_content":true,"pinned_to_root":false}'
    });

    await pinSavedSearchToRoot('s-1');

    const updated = rows.find((r) => r.id === 's-1')!;
    expect('folder_id' in updated).toBe(false);
    expect(updated.metadata_encrypted).toBe(
      'encobj:{"search_in_content":true,"pinned_to_root":true}'
    );
    expect(updated.sync_status).toBe('pending');
    expect(pushUpdateSpy).toHaveBeenCalledWith('s-1', {
      folder_id: null,
      metadata_encrypted: 'encobj:{"search_in_content":true,"pinned_to_root":true}'
    });
  });

  it('backfills a missing bundle when pinning a legacy row to root', async () => {
    seed({ id: 's-1' }); // no metadata bundle at all

    await pinSavedSearchToRoot('s-1');

    const updated = rows.find((r) => r.id === 's-1')!;
    expect(updated.metadata_encrypted).toBe(
      'encobj:{"search_in_content":false,"pinned_to_root":true}'
    );
    expect(pushUpdateSpy).toHaveBeenCalledWith('s-1', {
      folder_id: null,
      metadata_encrypted: 'encobj:{"search_in_content":false,"pinned_to_root":true}'
    });
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
