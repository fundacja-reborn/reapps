import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeleteFolderProgress } from './folder.service';

// ── Module mocks ─────────────────────────────────────────────────────────
// deleteFolder is exercised against an in-memory note/folder fake; sync
// pushes and the search index are spies. The spec locks the progress
// contract (phase ordering, stable totals, clamping, opt-in count sweep),
// not the storage internals.

type NoteRow = {
  id: string;
  folder_id?: string | null;
  is_archived?: boolean;
  is_ephemeral?: boolean;
  metadata_encrypted?: string;
  sync_status: string;
};

const notesById = new Map<string, NoteRow>();
let descendantIds: string[] = [];
const deletedFolderIds: string[] = [];

// Call-observable so the "count sweep only when a listener asks" behavior
// is testable via call counts.
const byFolderSpy = vi.fn(async (fid: string) =>
  [...notesById.values()].filter((n) => n.folder_id === fid && !n.is_archived)
);

vi.mock('@reborn/storage', () => ({
  folderOperations: {
    getDescendantIds: async () => [...descendantIds],
    deleteFolder: async (fid: string) => {
      deletedFolderIds.push(fid);
    }
  },
  folderQueries: {},
  folderStore: {},
  noteOperations: {
    moveToTrash: async (id: string) => {
      const n = notesById.get(id);
      if (n) n.is_archived = true;
    },
    moveToFolder: async (id: string, folderId: string | null) => {
      const n = notesById.get(id);
      if (n) n.folder_id = folderId;
    }
  },
  noteQueries: { byFolder: (fid: string) => byFolderSpy(fid) },
  noteStore: {
    get: async (id: string) => {
      const n = notesById.get(id);
      return n ? { ...n } : undefined;
    },
    save: async (row: NoteRow) => {
      notesById.set(row.id, { ...row });
    }
  },
  savedSearchStore: { query: async () => [] }
}));

vi.mock('@reborn/crypto', () => ({
  cryptoManager: {
    isInitialized: () => true,
    encryptText: async (s: string) => s,
    decryptText: async (s: string) => s
  }
}));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ userId: 'u1' }) };
});

const pushNoteUpdateSpy = vi.fn();
const pushNoteDeleteSpy = vi.fn();
const pushFolderDeleteSpy = vi.fn();
vi.mock('./notes-sync.service', () => ({
  pushFolder: vi.fn(),
  pushFolderUpdate: vi.fn(),
  pushFolderDelete: (id: string) => pushFolderDeleteSpy(id),
  pushNoteUpdate: (...args: unknown[]) => pushNoteUpdateSpy(...args),
  pushNoteDelete: (...args: unknown[]) => pushNoteDeleteSpy(...args),
  pushSavedSearchUpdate: vi.fn()
}));

// Folders that are in the archive, as the folder store would report them.
const archivedFolders = new Map<string, { rootId: string; at: string }>();
const indexPatchSpy = vi.fn();
vi.mock('$lib/services/note-index.svelte', () => ({
  noteIndex: {
    patch: (...args: unknown[]) => indexPatchSpy(...args),
    archivedFolder: (fid: string) => archivedFolders.get(fid)
  }
}));

// Imported dynamically AFTER the mock/state declarations above so the mock
// factories never touch an uninitialized module-scope binding (TDZ).
const { deleteFolder } = await import('./folder.service');

function seedNote(id: string, folderId: string, sync_status = 'synced'): void {
  notesById.set(id, { id, folder_id: folderId, sync_status });
}

beforeEach(() => {
  notesById.clear();
  descendantIds = [];
  deletedFolderIds.length = 0;
  archivedFolders.clear();
  indexPatchSpy.mockClear();
  byFolderSpy.mockClear();
  pushNoteUpdateSpy.mockClear();
  pushNoteDeleteSpy.mockClear();
  pushFolderDeleteSpy.mockClear();
});

describe('deleteFolder progress reporting', () => {
  it('detach: notes phase 0..N, then folders phase 0..M bottom-up', async () => {
    descendantIds = ['child'];
    seedNote('n1', 'root');
    seedNote('n2', 'root');
    seedNote('n3', 'child');

    const events: DeleteFolderProgress[] = [];
    await deleteFolder('root', 'detach', (p) => events.push(p));

    expect(events).toEqual([
      { phase: 'notes', current: 0, total: 3 },
      { phase: 'notes', current: 1, total: 3 },
      { phase: 'notes', current: 2, total: 3 },
      { phase: 'notes', current: 3, total: 3 },
      { phase: 'folders', current: 0, total: 2 },
      { phase: 'folders', current: 1, total: 2 },
      { phase: 'folders', current: 2, total: 2 }
    ]);
    // Bottom-up: the descendant is deleted before the root.
    expect(deletedFolderIds).toEqual(['child', 'root']);
    // Every note was detached and its update pushed.
    expect(pushNoteUpdateSpy).toHaveBeenCalledTimes(3);
    expect([...notesById.values()].every((n) => n.folder_id == null)).toBe(true);
  });

  it('cascade: archives notes and reports the same progress shape', async () => {
    seedNote('n1', 'root');
    seedNote('n2', 'root', 'pending');

    const events: DeleteFolderProgress[] = [];
    await deleteFolder('root', 'cascade', (p) => events.push(p));

    expect(events).toEqual([
      { phase: 'notes', current: 0, total: 2 },
      { phase: 'notes', current: 1, total: 2 },
      { phase: 'notes', current: 2, total: 2 },
      { phase: 'folders', current: 0, total: 1 },
      { phase: 'folders', current: 1, total: 1 }
    ]);
    expect([...notesById.values()].every((n) => n.is_archived)).toBe(true);
    // Only the already-synced note pushes a server DELETE.
    expect(pushNoteDeleteSpy).toHaveBeenCalledTimes(1);
    expect(pushNoteDeleteSpy).toHaveBeenCalledWith('n1');
  });

  it('empty folder: skips the notes phase entirely', async () => {
    const events: DeleteFolderProgress[] = [];
    await deleteFolder('root', 'detach', (p) => events.push(p));

    expect(events).toEqual([
      { phase: 'folders', current: 0, total: 1 },
      { phase: 'folders', current: 1, total: 1 }
    ]);
  });

  it('without onProgress the extra count sweep is skipped', async () => {
    descendantIds = ['child'];
    seedNote('n1', 'root');

    await deleteFolder('root', 'detach');

    // One byFolder read per folder for processing - none for counting.
    expect(byFolderSpy).toHaveBeenCalledTimes(2);
  });

  it('with onProgress each folder is read twice (count sweep + processing)', async () => {
    descendantIds = ['child'];
    seedNote('n1', 'root');

    await deleteFolder('root', 'detach', () => {});

    expect(byFolderSpy).toHaveBeenCalledTimes(4);
  });

  it('clamps current at total when notes appear between count and processing', async () => {
    seedNote('n1', 'root');
    seedNote('n2', 'root');
    // The count sweep sees a stale single-note view (as if the second note
    // landed from a concurrent sync pull right after counting).
    byFolderSpy.mockImplementationOnce(async () => [
      { id: 'n1', folder_id: 'root', sync_status: 'synced' }
    ]);

    const events: DeleteFolderProgress[] = [];
    await deleteFolder('root', 'detach', (p) => events.push(p));

    expect(events.filter((e) => e.phase === 'notes')).toEqual([
      { phase: 'notes', current: 0, total: 1 },
      { phase: 'notes', current: 1, total: 1 },
      { phase: 'notes', current: 1, total: 1 }
    ]);
  });
});

// The mocked crypto is the identity, so a "ciphertext" is the padded JSON.
const bundleOf = (id: string) => JSON.parse(notesById.get(id)!.metadata_encrypted ?? '{}');

describe('deleteFolder (detach) keeps archived notes in the archive', () => {
  const AT = '2026-11-13T09:00:00.000Z';

  it('gives a note archived through the folder its own marker, in the same push', async () => {
    descendantIds = ['child'];
    archivedFolders.set('child', { rootId: 'child', at: AT });
    seedNote('active', 'root');
    seedNote('via-folder', 'child');
    notesById.get('via-folder')!.metadata_encrypted = JSON.stringify({ is_starred: true, tags: [] });

    await deleteFolder('root', 'detach');

    // The note that was only in the archive because of its folder stays there.
    expect(notesById.get('via-folder')!.folder_id).toBeNull();
    expect(bundleOf('via-folder')).toMatchObject({ is_starred: true, tags: [], archived_at: AT });
    expect(pushNoteUpdateSpy).toHaveBeenCalledWith('via-folder', {
      folder_id: null,
      metadata_encrypted: notesById.get('via-folder')!.metadata_encrypted
    });
    expect(indexPatchSpy).toHaveBeenCalledWith('via-folder', {
      folderId: undefined,
      archivedAt: AT
    });
    // A note from an active folder is detached as before, bundle untouched.
    expect(notesById.get('active')!.metadata_encrypted).toBeUndefined();
    expect(pushNoteUpdateSpy).toHaveBeenCalledWith('active', { folder_id: null });
    expect(indexPatchSpy).toHaveBeenCalledWith('active', { folderId: undefined });
  });

  it('leaves a note that already has its own marker alone', async () => {
    archivedFolders.set('root', { rootId: 'root', at: AT });
    seedNote('own', 'root');
    const own = JSON.stringify({ tags: [], archived_at: '2026-01-01T00:00:00.000Z' });
    notesById.get('own')!.metadata_encrypted = own;

    await deleteFolder('root', 'detach');

    expect(notesById.get('own')!.metadata_encrypted).toBe(own);
    expect(pushNoteUpdateSpy).toHaveBeenCalledWith('own', { folder_id: null });
  });

  it('does not touch the bundle in cascade mode (the note goes to the trash)', async () => {
    archivedFolders.set('root', { rootId: 'root', at: AT });
    seedNote('n1', 'root');

    await deleteFolder('root', 'cascade');

    expect(notesById.get('n1')!.metadata_encrypted).toBeUndefined();
    expect(notesById.get('n1')!.is_archived).toBe(true); // wire name of the trash flag
  });
});
