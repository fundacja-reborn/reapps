import { describe, it, expect, vi, beforeEach } from 'vitest';

type NoteRow = {
  id: string;
  metadata_encrypted?: string;
  is_pinned?: boolean;
  is_starred?: boolean;
};

const cryptoState = {
  initialized: true,
  decryptImpl: vi.fn<(value: string) => Promise<unknown>>()
};
const noteRows: NoteRow[] = [];
const tagRowsByNote: Map<string, string[]> = new Map();
const saveSpy = vi.fn();
const addTagSpy = vi.fn();
const removeTagSpy = vi.fn();

vi.mock('@reborn/crypto', () => ({
  cryptoManager: {
    isInitialized: () => cryptoState.initialized,
    decryptObject: <T>(value: string) => cryptoState.decryptImpl(value) as Promise<T>
  }
}));

vi.mock('@reborn/storage', () => ({
  noteStore: {
    // The reconciler scans the metadata projection (DB v14 split); these rows
    // carry no content_encrypted, matching the real getAllMeta() shape.
    getAllMeta: async () => noteRows,
    // Drift writes re-read the full record before save().
    get: async (id: string) => noteRows.find((r) => r.id === id) ?? null,
    save: async (row: NoteRow) => {
      saveSpy(row);
      const idx = noteRows.findIndex((r) => r.id === row.id);
      if (idx >= 0) noteRows[idx] = row;
    }
  },
  noteTagQueries: {
    getTagsForNote: async (noteId: string) => tagRowsByNote.get(noteId) ?? []
  },
  noteTagOperations: {
    addTagToNote: async (noteId: string, tagId: string) => {
      addTagSpy(noteId, tagId);
      const existing = tagRowsByNote.get(noteId) ?? [];
      if (!existing.includes(tagId)) tagRowsByNote.set(noteId, [...existing, tagId]);
    },
    removeTagFromNote: async (noteId: string, tagId: string) => {
      removeTagSpy(noteId, tagId);
      const existing = tagRowsByNote.get(noteId) ?? [];
      tagRowsByNote.set(
        noteId,
        existing.filter((t) => t !== tagId)
      );
    }
  }
}));

const { verifyAndRebuildLocalShadowIndexes } = await import('./shadow-index-reconciler.service');

beforeEach(() => {
  cryptoState.initialized = true;
  cryptoState.decryptImpl = vi.fn();
  noteRows.length = 0;
  tagRowsByNote.clear();
  saveSpy.mockReset();
  addTagSpy.mockReset();
  removeTagSpy.mockReset();
});

describe('verifyAndRebuildLocalShadowIndexes', () => {
  it('rewrites shadow indexes when decrypted metadata disagrees with IDB', async () => {
    noteRows.push({
      id: 'note-a',
      metadata_encrypted: 'iv:cipher',
      is_pinned: false,
      is_starred: false
    });
    cryptoState.decryptImpl.mockResolvedValue({
      is_pinned: true,
      is_starred: true,
      tags: ['tag-1']
    });

    const result = await verifyAndRebuildLocalShadowIndexes();

    expect(result).toEqual({ scanned: 1, reconciledNotes: 1, decryptFailed: 0 });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'note-a', is_pinned: true, is_starred: true })
    );
    expect(addTagSpy).toHaveBeenCalledWith('note-a', 'tag-1');
    expect(removeTagSpy).not.toHaveBeenCalled();
  });

  it('removes stale tag associations and adds new ones when metadata drifted', async () => {
    noteRows.push({
      id: 'note-b',
      metadata_encrypted: 'iv:cipher',
      is_pinned: true,
      is_starred: false
    });
    tagRowsByNote.set('note-b', ['old-tag', 'shared-tag']);
    cryptoState.decryptImpl.mockResolvedValue({
      is_pinned: true,
      is_starred: false,
      tags: ['shared-tag', 'new-tag']
    });

    const result = await verifyAndRebuildLocalShadowIndexes();

    expect(result.reconciledNotes).toBe(1);
    expect(addTagSpy).toHaveBeenCalledWith('note-b', 'new-tag');
    expect(removeTagSpy).toHaveBeenCalledWith('note-b', 'old-tag');
    // is_pinned/is_starred match the IDB row, so noteStore.save must NOT run.
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('leaves IDB untouched when the metadata bundle cannot be decrypted', async () => {
    noteRows.push({
      id: 'note-c',
      metadata_encrypted: 'iv:cipher',
      is_pinned: false,
      is_starred: false
    });
    cryptoState.decryptImpl.mockRejectedValue(new Error('OperationError'));

    const result = await verifyAndRebuildLocalShadowIndexes();

    expect(result).toEqual({ scanned: 1, reconciledNotes: 0, decryptFailed: 1 });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(addTagSpy).not.toHaveBeenCalled();
    expect(removeTagSpy).not.toHaveBeenCalled();
  });

  it('returns a no-op early when the crypto manager is not initialized', async () => {
    cryptoState.initialized = false;
    noteRows.push({
      id: 'note-d',
      metadata_encrypted: 'iv:cipher',
      is_pinned: false,
      is_starred: false
    });

    const result = await verifyAndRebuildLocalShadowIndexes();

    expect(result).toEqual({ scanned: 0, reconciledNotes: 0, decryptFailed: 0 });
    expect(cryptoState.decryptImpl).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('skips notes without a metadata bundle without touching IDB', async () => {
    noteRows.push({ id: 'legacy', metadata_encrypted: '', is_pinned: false, is_starred: false });
    noteRows.push({ id: 'unset', is_pinned: false, is_starred: false });
    cryptoState.decryptImpl.mockImplementation(async () => {
      throw new Error('should not be called for empty metadata');
    });

    const result = await verifyAndRebuildLocalShadowIndexes();

    expect(result).toEqual({ scanned: 2, reconciledNotes: 0, decryptFailed: 0 });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(cryptoState.decryptImpl).not.toHaveBeenCalled();
  });
});
