import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FolderEncrypted } from '@reborn/types';

// ── Module mocks ─────────────────────────────────────────────────────────
// setFolderAppearance / getFolderTree against an in-memory folder store and a
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
const { setFolderAppearance, getFolderTree } = await import('./folder.service');
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

beforeEach(() => {
  foldersById.clear();
  pushFolderUpdateSpy.mockClear();
});

describe('setFolderAppearance', () => {
  it('encrypts the bundle, marks the row pending and pushes only the ciphertext', async () => {
    seedFolder('f1');

    await setFolderAppearance('f1', { color: 'green', icon: 'leaf' });

    const row = foldersById.get('f1')!;
    expect(row.sync_status).toBe('pending');
    expect(row.metadata_encrypted).toMatch(/^enc:/);
    expect(await decodeFolderMetadata(cryptoManager, row.metadata_encrypted)).toEqual({
      color: 'green',
      icon: 'leaf'
    });
    expect(pushFolderUpdateSpy).toHaveBeenCalledWith('f1', {
      metadata_encrypted: row.metadata_encrypted
    });
    // Zero Knowledge: the push carries no plaintext color/icon field.
    const pushed = pushFolderUpdateSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(pushed)).toEqual(['metadata_encrypted']);
  });

  it('changes only the named field and keeps unknown ones from newer versions', async () => {
    seedFolder('f1', {
      metadata_encrypted: await encodeFolderMetadata(cryptoManager, {
        color: 'red',
        icon: 'future-icon',
        pinned: true
      })
    });

    await setFolderAppearance('f1', { color: 'blue' });

    expect(
      await decodeFolderMetadata(cryptoManager, foldersById.get('f1')!.metadata_encrypted)
    ).toEqual({ color: 'blue', icon: 'future-icon', pinned: true });
  });

  it('resets a field with undefined', async () => {
    seedFolder('f1', {
      metadata_encrypted: await encodeFolderMetadata(cryptoManager, { color: 'red', icon: 'star' })
    });

    await setFolderAppearance('f1', { icon: undefined });

    expect(
      await decodeFolderMetadata(cryptoManager, foldersById.get('f1')!.metadata_encrypted)
    ).toEqual({ color: 'red' });
  });

  it('replaces an undecryptable bundle (repair)', async () => {
    seedFolder('f1', { metadata_encrypted: 'foreign:ciphertext' });

    await setFolderAppearance('f1', { color: 'pink' });

    expect(
      await decodeFolderMetadata(cryptoManager, foldersById.get('f1')!.metadata_encrypted)
    ).toEqual({ color: 'pink' });
  });

  it('rejects values outside the closed sets without writing', async () => {
    seedFolder('f1');

    await expect(setFolderAppearance('f1', { color: '#ff0000' })).rejects.toThrow();
    await expect(setFolderAppearance('f1', { icon: 'rocket' })).rejects.toThrow();

    expect(foldersById.get('f1')!.sync_status).toBe('synced');
    expect(pushFolderUpdateSpy).not.toHaveBeenCalled();
  });
});

describe('getFolderTree appearance', () => {
  it('decrypts color/icon next to the name', async () => {
    seedFolder('f1', {
      metadata_encrypted: await encodeFolderMetadata(cryptoManager, {
        color: 'violet',
        icon: 'code'
      })
    });

    const [folder] = await getFolderTree();

    expect(folder).toMatchObject({ name: 'f1-name', color: 'violet', icon: 'code' });
    expect(folder.decrypt_failed).toBeUndefined();
  });

  it('degrades an undecryptable bundle to the default look without flagging the folder', async () => {
    seedFolder('f1', { metadata_encrypted: 'foreign:ciphertext' });

    const [folder] = await getFolderTree();

    expect(folder.name).toBe('f1-name');
    expect(folder.color).toBeUndefined();
    expect(folder.icon).toBeUndefined();
    expect(folder.decrypt_failed).toBeUndefined();
  });
});
