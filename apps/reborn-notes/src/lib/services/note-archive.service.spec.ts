import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteStoredLocal } from '@reborn/types';

// ── Module mocks ─────────────────────────────────────────────────────────
// setNoteArchived / decryptTitleOnly against an in-memory note store and a
// length-preserving fake cipher (tagged, so a foreign value fails to decrypt
// like AES-GCM under the wrong key). Sync pushes and the index are spies.

const rows = new Map<string, NoteStoredLocal>();
const localTags = new Map<string, string[]>();

vi.mock('@reborn/crypto', () => ({
  cryptoManager: {
    isInitialized: () => true,
    encryptText: async (value: string) => `enc:${value}`,
    decryptText: async (stored: string) => {
      if (!stored.startsWith('enc:')) throw new Error('OperationError');
      return stored.slice(4);
    },
    encryptObject: async (value: unknown) => `enc:${JSON.stringify(value)}`,
    decryptObject: async (stored: string) => {
      if (!stored.startsWith('enc:')) throw new Error('OperationError');
      return JSON.parse(stored.slice(4));
    }
  }
}));

vi.mock('@reborn/storage', () => ({
  noteStore: {
    get: async (id: string) => {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    save: async (row: NoteStoredLocal) => {
      rows.set(row.id, { ...row });
    }
  },
  noteQueries: {},
  noteOperations: {},
  noteTagStore: { getAll: async () => [] },
  noteTagQueries: { getTagsForNote: async (id: string) => localTags.get(id) ?? [] },
  noteHistoryQueries: {},
  noteHistoryOperations: {}
}));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ userId: 'user-1', isAuthenticated: true }) };
});
vi.mock('$lib/stores/connectivity.store', () => ({ checkOnline: () => false }));

const indexPatch = vi.fn();
vi.mock('$lib/services/note-index.svelte', () => ({
  noteIndex: { update: vi.fn(), patch: (...a: unknown[]) => indexPatch(...a), remove: vi.fn() }
}));
vi.mock('$lib/services/note-link-graph.svelte', () => ({
  noteLinkGraph: { onNoteSaved: vi.fn(), onNoteRemoved: vi.fn(), clear: vi.fn() }
}));
vi.mock('$lib/services/note-nav-history.svelte', () => ({
  noteNavHistory: { remove: vi.fn(), clear: vi.fn() }
}));

const pushNoteMutation = vi.fn();
vi.mock('./notes-sync.service', () => ({
  pushNote: vi.fn(),
  pushNoteUpdate: vi.fn(),
  pushNoteMutation: (...a: unknown[]) => pushNoteMutation(...a),
  pushNoteDelete: vi.fn(),
  pushNoteRestore: vi.fn(),
  pushNoteVersion: vi.fn(),
  pullNoteVersionsForNote: vi.fn()
}));

// Imported AFTER the mocks.
const { setNoteArchived, decryptTitleOnly, togglePin } = await import('./note.service');
const { decodeNoteMetadata, encodeNoteMetadata } = await import('./note-metadata');
const { cryptoManager } = await import('@reborn/crypto');

const TAG = '123e4567-e89b-12d3-a456-426614174000';

async function seed(id: string, extra: Partial<NoteStoredLocal> = {}): Promise<void> {
  rows.set(id, {
    id,
    user_id: 'user-1',
    folder_id: 'folder-1',
    title_encrypted: `enc:${id} title`,
    content_encrypted: 'enc:body',
    metadata_encrypted: await encodeNoteMetadata(cryptoManager, {
      is_pinned: true,
      is_starred: false,
      tags: [TAG],
      color: 'blue'
    }),
    is_pinned: true,
    is_starred: false,
    is_archived: false,
    sync_status: 'synced',
    sync_version: 4,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    ...extra
  });
}

const stored = (id: string) => decodeNoteMetadata(cryptoManager, rows.get(id)!.metadata_encrypted);

beforeEach(() => {
  rows.clear();
  localTags.clear();
  pushNoteMutation.mockClear();
  indexPatch.mockClear();
});

describe('setNoteArchived', () => {
  it('sets the marker inside the encrypted bundle and moves nothing', async () => {
    await seed('n1');

    expect(await setNoteArchived('n1', true)).toBe(true);

    const meta = await stored('n1');
    expect(meta).toMatchObject({ is_pinned: true, is_starred: false, tags: [TAG], color: 'blue' });
    expect(meta!.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const row = rows.get('n1')!;
    // The note keeps its folder: restoring puts it back where it was.
    expect(row.folder_id).toBe('folder-1');
    expect(row.sync_status).toBe('pending');
    expect(indexPatch).toHaveBeenCalledWith('n1', { archivedAt: meta!.archived_at });
  });

  it('is independent of the trash flag and stores no plaintext marker', async () => {
    await seed('n1');

    await setNoteArchived('n1', true);

    const row = rows.get('n1')!;
    // `is_archived` is the wire name of the TRASH flag - archiving must not set it.
    expect(row.is_archived).toBe(false);
    // Zero Knowledge: only the ciphertext is pushed; no plain `archived_at`
    // on the push or on the IndexedDB row (the Encryption Guard rejects it).
    expect(pushNoteMutation).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), false, {
      metadata_encrypted: row.metadata_encrypted
    });
    expect(Object.keys(pushNoteMutation.mock.calls[0][2])).toEqual(['metadata_encrypted']);
    expect(row).not.toHaveProperty('archived_at');
  });

  it('hides the state: archived and active bundles have the same ciphertext length', async () => {
    await seed('n1');
    await togglePin('n1'); // re-encode under the current padding first
    const active = rows.get('n1')!.metadata_encrypted!.length;

    await setNoteArchived('n1', true);
    expect(rows.get('n1')!.metadata_encrypted!.length).toBe(active);

    await setNoteArchived('n1', false);
    expect(rows.get('n1')!.metadata_encrypted!.length).toBe(active);
  });

  it('restoring removes the marker and keeps every other field', async () => {
    await seed('n1');
    await setNoteArchived('n1', true);
    indexPatch.mockClear();

    expect(await setNoteArchived('n1', false)).toBe(true);

    expect(await stored('n1')).toEqual({
      is_pinned: true,
      is_starred: false,
      tags: [TAG],
      color: 'blue'
    });
    expect(indexPatch).toHaveBeenCalledWith('n1', { archivedAt: undefined });
  });

  it('is a no-op when the note is already in the requested state', async () => {
    await seed('n1');

    expect(await setNoteArchived('n1', false)).toBe(false);
    await setNoteArchived('n1', true);
    const before = rows.get('n1')!.metadata_encrypted;
    pushNoteMutation.mockClear();

    expect(await setNoteArchived('n1', true)).toBe(false);
    expect(rows.get('n1')!.metadata_encrypted).toBe(before); // the date is not bumped
    expect(pushNoteMutation).not.toHaveBeenCalled();
    expect(await setNoteArchived('missing', true)).toBe(false);
  });

  it('survives a pin change made afterwards (the read-modify-write of older code paths)', async () => {
    await seed('n1');
    await setNoteArchived('n1', true);
    const at = (await stored('n1'))!.archived_at;

    await togglePin('n1');

    expect((await stored('n1'))!.archived_at).toBe(at);
    expect((await stored('n1'))!.is_pinned).toBe(false);
  });

  it('rebuilds an undecryptable bundle when archiving, and has nothing to restore from one', async () => {
    await seed('n1', { metadata_encrypted: 'foreign:ciphertext', is_starred: true });
    localTags.set('n1', [TAG]);

    expect(await setNoteArchived('n1', false)).toBe(false);
    expect(rows.get('n1')!.metadata_encrypted).toBe('foreign:ciphertext');

    expect(await setNoteArchived('n1', true)).toBe(true);
    const meta = await stored('n1');
    expect(meta).toMatchObject({ is_pinned: true, is_starred: true, tags: [TAG] });
    expect(meta!.archived_at).toBeDefined();
  });

  it('promotes a pristine new note, like pin and star do (#349)', async () => {
    await seed('n1', { is_ephemeral: true, sync_version: 0 });

    await setNoteArchived('n1', true);

    expect(rows.get('n1')!.is_ephemeral).toBe(false);
    expect(pushNoteMutation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n1', is_ephemeral: false }),
      true,
      expect.anything()
    );
  });
});

describe('decryptTitleOnly - archive marker for the note index', () => {
  it('reads the marker from the bundle', async () => {
    await seed('n1');
    await setNoteArchived('n1', true);
    const at = (await stored('n1'))!.archived_at;

    const entry = await decryptTitleOnly(rows.get('n1')!);

    expect(entry.archivedAt).toBe(at);
    expect(entry.isTrashed).toBe(false);
  });

  it('reads "not archived" for a note without a marker, a malformed one, or a broken bundle', async () => {
    await seed('plain');
    expect((await decryptTitleOnly(rows.get('plain')!)).archivedAt).toBeUndefined();

    await seed('garbage', {
      metadata_encrypted: await encodeNoteMetadata(cryptoManager, {
        tags: [],
        archived_at: 'not a date'
      })
    });
    expect((await decryptTitleOnly(rows.get('garbage')!)).archivedAt).toBeUndefined();

    await seed('broken', { metadata_encrypted: 'foreign:ciphertext' });
    const broken = await decryptTitleOnly(rows.get('broken')!);
    // Safe direction: the note stays visible among the active ones.
    expect(broken.archivedAt).toBeUndefined();
    expect(broken.decryptFailed).toBe(false);
  });
});
