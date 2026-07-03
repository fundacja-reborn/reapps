import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteStoredLocal } from '@reborn/types';

// Undecryptable-row wiring for notes (guideline 63, #15). Notes are the one
// entity with TWO decode paths - the full codec (toDecrypted, editor/trash)
// and the title-only NoteIndex path - sharing a single session cache, so this
// spec focuses on their interplay on top of the per-row flagging basics.

const rows = new Map<string, NoteStoredLocal>();
const decryptTextSpy = vi.fn(async (stored: string) => {
  if (stored.startsWith('bad:')) throw new Error('OperationError');
  return stored.replace(/^enc:/, '');
});

vi.mock('@reborn/crypto', () => ({
  cryptoManager: {
    isInitialized: () => true,
    encryptText: async (value: string) => `enc:${value}`,
    decryptText: (stored: string) => decryptTextSpy(stored),
    encryptObject: async (value: unknown) => `encobj:${JSON.stringify(value)}`,
    decryptObject: async (stored: string) => JSON.parse(stored.replace(/^encobj:/, ''))
  }
}));

vi.mock('@reborn/storage', () => ({
  noteStore: {
    get: async (id: string) => rows.get(id) ?? null,
    getAll: async () => [...rows.values()],
    getMany: async (ids: string[]) => ids.map((id) => rows.get(id)).filter(Boolean),
    save: async (row: NoteStoredLocal) => {
      rows.set(row.id, row);
    },
    delete: async (id: string) => {
      rows.delete(id);
    },
    deleteMany: async (ids: string[]) => {
      ids.forEach((id) => rows.delete(id));
    }
  },
  noteQueries: {
    getActive: async () => [...rows.values()].filter((n) => !n.is_archived),
    getArchived: async () => [...rows.values()].filter((n) => n.is_archived),
    byFolder: async () => [],
    byFolders: async () => []
  },
  noteOperations: {},
  noteTagStore: { getAll: async () => [] },
  noteTagQueries: { getTagsForNote: async () => [], getNotesForTag: async () => [] },
  noteHistoryQueries: { getForNote: async () => [] },
  noteHistoryOperations: {
    saveVersion: async () => 'v-1',
    pruneVersions: async () => {},
    deleteAllForNote: async () => {}
  }
}));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ userId: 'user-1', isAuthenticated: true }) };
});

vi.mock('$lib/stores/connectivity.store', () => ({ checkOnline: () => false }));

vi.mock('$lib/services/note-index.svelte', () => ({
  noteIndex: { update: vi.fn(), patch: vi.fn(), remove: vi.fn(), get: () => undefined }
}));
vi.mock('$lib/services/note-link-graph.svelte', () => ({
  noteLinkGraph: { onNoteSaved: vi.fn(), onNoteRemoved: vi.fn(), clear: vi.fn() }
}));
vi.mock('$lib/services/note-nav-history.svelte', () => ({
  noteNavHistory: { remove: vi.fn(), clear: vi.fn() }
}));

vi.mock('./notes-sync.service', () => ({
  pushNote: vi.fn(),
  pushNoteUpdate: vi.fn(),
  pushNoteMutation: vi.fn(),
  pushNoteDelete: vi.fn(),
  pushNoteRestore: vi.fn(),
  pushNoteVersion: vi.fn(),
  pullNoteVersionsForNote: vi.fn()
}));

const { getNote, getAllNotes, decryptTitleOnly } = await import('./note.service');

function seed(partial: Partial<NoteStoredLocal> & { id: string }): NoteStoredLocal {
  const row: NoteStoredLocal = {
    user_id: 'user-1',
    title_encrypted: 'enc:Seeded title',
    content_encrypted: 'enc:Seeded content',
    is_archived: false,
    sync_version: 1,
    sync_status: 'synced',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...partial
  };
  rows.set(row.id, row);
  return row;
}

beforeEach(() => {
  rows.clear();
  decryptTextSpy.mockClear();
  // NOTE: the service keeps a module-scoped session cache of undecryptable
  // rows (keyed by id + updated_at) which survives between tests - seed
  // corrupt rows under ids unique to their test.
});

describe('undecryptable note rows (foreign key epoch / corruption)', () => {
  it('flags the row and degrades both fields when the title does not decrypt', async () => {
    seed({ id: 'ghost-1', title_encrypted: 'bad:title' });

    const ghost = await getNote('ghost-1');

    expect(ghost!.decrypt_failed).toBe(true);
    expect(ghost!.title).toBe('');
    expect(ghost!.content).toBe('');
  });

  it('flags the row when only the content is corrupt', async () => {
    seed({ id: 'ghost-2', content_encrypted: 'bad:content' });

    const ghost = await getNote('ghost-2');

    expect(ghost!.decrypt_failed).toBe(true);
    expect(ghost!.title).toBe('');
  });

  it('leaves healthy rows unflagged next to a corrupt one', async () => {
    seed({ id: 'ghost-3', title_encrypted: 'bad:title' });
    seed({ id: 'fine-3' });

    const byId = new Map((await getAllNotes()).map((n) => [n.id, n]));

    expect(byId.get('ghost-3')!.decrypt_failed).toBe(true);
    expect(byId.get('fine-3')!.decrypt_failed).toBeUndefined();
    expect(byId.get('fine-3')!.title).toBe('Seeded title');
  });

  it('does not re-decrypt a known-bad row until its updated_at changes', async () => {
    seed({ id: 'ghost-4', title_encrypted: 'bad:title' });

    await getNote('ghost-4');

    decryptTextSpy.mockClear();
    const stillGhost = await getNote('ghost-4');
    expect(stillGhost!.decrypt_failed).toBe(true);
    expect(decryptTextSpy).not.toHaveBeenCalled();

    // Rewritten row (e.g. repaired from a device holding the right key):
    // retried, decodes normally, sticky entry dropped.
    seed({ id: 'ghost-4', updated_at: '2026-06-02T00:00:00.000Z' });
    const repaired = await getNote('ghost-4');
    expect(repaired!.decrypt_failed).toBeUndefined();
    expect(repaired!.title).toBe('Seeded title');
  });

  describe('title-only path (NoteIndex) sharing the session cache', () => {
    it('flags a title-corrupt row and skips decryption on later calls', async () => {
      const enc = seed({ id: 'ghost-5', title_encrypted: 'bad:title' });

      const first = await decryptTitleOnly(enc);
      expect(first.decryptFailed).toBe(true);
      expect(first.title).toBe('');

      decryptTextSpy.mockClear();
      // Cache hit - both the title-only path AND the full codec skip decoding.
      const second = await decryptTitleOnly(enc);
      expect(second.decryptFailed).toBe(true);
      const full = await getNote('ghost-5');
      expect(full!.decrypt_failed).toBe(true);
      expect(decryptTextSpy).not.toHaveBeenCalled();
    });

    it('inherits a content-corruption mark made by the full codec', async () => {
      const enc = seed({ id: 'ghost-6', content_encrypted: 'bad:content' });

      // Title decodes, so the title-only path alone cannot see the corruption...
      const before = await decryptTitleOnly(enc);
      expect(before.decryptFailed).toBe(false);

      // ...but once the full codec marks the row, the index path serves the
      // flag from the shared cache without another decrypt attempt.
      await getNote('ghost-6');
      decryptTextSpy.mockClear();
      const after = await decryptTitleOnly(enc);
      expect(after.decryptFailed).toBe(true);
      expect(after.title).toBe('');
      expect(decryptTextSpy).not.toHaveBeenCalled();
    });

    it('a healthy title-only decode does not clear a full-codec mark (same row version)', async () => {
      const enc = seed({ id: 'ghost-7', content_encrypted: 'bad:content' });
      await getNote('ghost-7'); // marks

      // Title-only ran BEFORE the mark in some other tab/path - simulate by
      // calling it now on the same updated_at: it must serve the flag, not
      // "repair" the cache entry with its partial success.
      const view = await decryptTitleOnly(enc);
      expect(view.decryptFailed).toBe(true);

      const full = await getNote('ghost-7');
      expect(full!.decrypt_failed).toBe(true);
    });
  });
});
