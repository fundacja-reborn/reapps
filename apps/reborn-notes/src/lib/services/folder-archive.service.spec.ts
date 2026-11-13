import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FolderEncrypted } from '@reborn/types';

// ── Module mocks ─────────────────────────────────────────────────────────
// setFolderArchived / getFolderTree against an in-memory folder store and a
// length-preserving fake cipher (tagged, so a foreign value fails to decrypt
// like AES-GCM under the wrong key). Sync pushes are spies.

const foldersById = new Map<string, FolderEncrypted>();

vi.mock('@reborn/storage', () => ({
  folderOperations: {},
  folderQueries: {
    getFolderTree: async () => [...foldersById.values()].map((f) => ({ ...f, children: [] }))
  },
  folderStore: {
    get: async (id: string) => {
      const f = foldersById.get(id);
      return f ? { ...f } : undefined;
    },
    save: async (row: FolderEncrypted) => {
      foldersById.set(row.id, { ...row });
    }
  },
  noteOperations: {},
  noteQueries: {},
  noteStore: {},
  savedSearchStore: {}
}));

vi.mock('@reborn/crypto', () => ({
  cryptoManager: {
    isInitialized: () => true,
    encryptText: async (s: string) => `enc:${s}`,
    decryptText: async (s: string) => {
      if (!s.startsWith('enc:')) throw new Error('decrypt failed');
      return s.slice(4);
    }
  }
}));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ userId: 'u1' }) };
});

const pushFolderUpdateSpy = vi.fn();
vi.mock('./notes-sync.service', () => ({
  pushFolder: vi.fn(),
  pushFolderUpdate: (...args: unknown[]) => pushFolderUpdateSpy(...args),
  pushFolderDelete: vi.fn(),
  pushNoteUpdate: vi.fn(),
  pushNoteDelete: vi.fn(),
  pushSavedSearchUpdate: vi.fn()
}));

vi.mock('$lib/services/note-index.svelte', () => ({ noteIndex: { patch: vi.fn() } }));
vi.mock('$lib/utils/app-settings', () => ({ getSetting: async () => 'alphabetical' }));

// Imported AFTER the mocks (TDZ - see folder-delete-progress.spec.ts).
const { setFolderArchived, setFolderAppearance, getFolderTree } = await import(
  './folder.service'
);
const { decodeFolderMetadata, encodeFolderMetadata } = await import('./folder-metadata');
const { cryptoManager } = await import('@reborn/crypto');

function seedFolder(id: string, extra: Partial<FolderEncrypted> = {}): void {
  foldersById.set(id, {
    id,
    user_id: 'u1',
    name_encrypted: `enc:${id}-name`,
    order_index: 0,
    is_archived: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    sync_status: 'synced',
    sync_version: 3,
    ...extra
  } as FolderEncrypted);
}

const bundleOf = (id: string) =>
  decodeFolderMetadata(cryptoManager, foldersById.get(id)!.metadata_encrypted);

beforeEach(() => {
  foldersById.clear();
  pushFolderUpdateSpy.mockClear();
});

describe('setFolderArchived', () => {
  it('sets the marker in the encrypted bundle: one folder record, one push', async () => {
    seedFolder('f1', { parent_id: 'parent' });

    expect(await setFolderArchived('f1', true)).toBe(true);

    const row = foldersById.get('f1')!;
    const bundle = await bundleOf('f1');
    expect(bundle!.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.sync_status).toBe('pending');
    // Nothing is moved: the folder keeps its place in the tree.
    expect(row.parent_id).toBe('parent');
    expect(pushFolderUpdateSpy).toHaveBeenCalledTimes(1);
    expect(pushFolderUpdateSpy).toHaveBeenCalledWith('f1', {
      metadata_encrypted: row.metadata_encrypted
    });
  });

  it('does not use the plain is_archived column and pushes no plaintext marker', async () => {
    seedFolder('f1');

    await setFolderArchived('f1', true);

    const row = foldersById.get('f1')!;
    // Zero Knowledge: the server-visible column stays false, and the push
    // carries only the ciphertext.
    expect(row.is_archived).toBe(false);
    expect(row).not.toHaveProperty('archived_at');
    const pushed = pushFolderUpdateSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(pushed)).toEqual(['metadata_encrypted']);
  });

  it('hides the state: archived, restored and never-archived bundles have one length', async () => {
    seedFolder('f1');
    await setFolderAppearance('f1', { color: 'red' });
    const active = foldersById.get('f1')!.metadata_encrypted!.length;

    await setFolderArchived('f1', true);
    expect(foldersById.get('f1')!.metadata_encrypted!.length).toBe(active);

    await setFolderArchived('f1', false);
    expect(foldersById.get('f1')!.metadata_encrypted!.length).toBe(active);
  });

  it('keeps appearance and unknown fields, and restoring removes only the marker', async () => {
    seedFolder('f1', {
      metadata_encrypted: await encodeFolderMetadata(cryptoManager, {
        color: 'red',
        icon: 'star',
        pinned: true
      })
    });

    await setFolderArchived('f1', true);
    expect(await bundleOf('f1')).toMatchObject({ color: 'red', icon: 'star', pinned: true });

    expect(await setFolderArchived('f1', false)).toBe(true);
    expect(await bundleOf('f1')).toEqual({ color: 'red', icon: 'star', pinned: true });
  });

  it('a color change on an archived folder keeps it archived', async () => {
    seedFolder('f1');
    await setFolderArchived('f1', true);
    const at = (await bundleOf('f1'))!.archived_at;

    await setFolderAppearance('f1', { color: 'blue' });

    expect(await bundleOf('f1')).toEqual({ color: 'blue', archived_at: at });
  });

  it('is a no-op when already in the requested state', async () => {
    seedFolder('f1');

    expect(await setFolderArchived('f1', false)).toBe(false);
    await setFolderArchived('f1', true);
    const before = foldersById.get('f1')!.metadata_encrypted;
    pushFolderUpdateSpy.mockClear();

    expect(await setFolderArchived('f1', true)).toBe(false);
    expect(foldersById.get('f1')!.metadata_encrypted).toBe(before);
    expect(pushFolderUpdateSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown folder', async () => {
    await expect(setFolderArchived('missing', true)).rejects.toThrow('Folder not found');
  });
});

describe('getFolderTree - archive marker', () => {
  it('returns archived folders too, with their marker', async () => {
    seedFolder('active');
    seedFolder('old');
    await setFolderArchived('old', true);
    const at = (await bundleOf('old'))!.archived_at;

    const tree = await getFolderTree();

    const byId = new Map(tree.map((f) => [f.id, f]));
    expect(byId.get('old')!.archived_at).toBe(at);
    expect(byId.get('active')!.archived_at).toBeUndefined();
  });

  it('reads a folder with a malformed or undecryptable bundle as not archived', async () => {
    seedFolder('garbage', {
      metadata_encrypted: await encodeFolderMetadata(cryptoManager, { archived_at: 'soon' })
    });
    seedFolder('broken', { metadata_encrypted: 'foreign:ciphertext' });

    const tree = await getFolderTree();

    for (const f of tree) expect(f.archived_at).toBeUndefined();
  });
});
