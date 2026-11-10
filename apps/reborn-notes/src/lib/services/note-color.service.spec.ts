import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteStoredLocal } from '@reborn/types';

// ── Module mocks ─────────────────────────────────────────────────────────
// setNoteColor / decryptTitleOnly against an in-memory note store and a
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
const { setNoteColor, decryptTitleOnly } = await import('./note.service');
const { decodeNoteMetadata, encodeNoteMetadata } = await import('./note-metadata');
const { cryptoManager } = await import('@reborn/crypto');

const TAG = '123e4567-e89b-12d3-a456-426614174000';

async function seed(id: string, extra: Partial<NoteStoredLocal> = {}): Promise<void> {
  rows.set(id, {
    id,
    user_id: 'user-1',
    title_encrypted: `enc:${id} title`,
    content_encrypted: 'enc:body',
    metadata_encrypted: await encodeNoteMetadata(cryptoManager, {
      is_pinned: true,
      is_starred: false,
      tags: [TAG],
      periodic: { kind: 'daily', anchor: '2026-11-09' }
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

describe('setNoteColor', () => {
  it('writes the color into the encrypted bundle, keeping every other field', async () => {
    await seed('n1');

    expect(await setNoteColor('n1', 'green')).toBe(true);

    expect(await stored('n1')).toEqual({
      is_pinned: true,
      is_starred: false,
      tags: [TAG],
      periodic: { kind: 'daily', anchor: '2026-11-09' },
      color: 'green'
    });
    expect(rows.get('n1')!.sync_status).toBe('pending');
    expect(indexPatch).toHaveBeenCalledWith('n1', { color: 'green' });
  });

  it('pushes only the ciphertext and stores no plaintext color on the row', async () => {
    await seed('n1');

    await setNoteColor('n1', 'blue');

    const row = rows.get('n1')!;
    expect(pushNoteMutation).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), false, {
      metadata_encrypted: row.metadata_encrypted
    });
    // Zero Knowledge: no plaintext `color` next to the ciphertext - neither in
    // the push nor in the IndexedDB row (the Encryption Guard would reject it).
    expect(Object.keys(pushNoteMutation.mock.calls[0][2])).toEqual(['metadata_encrypted']);
    expect(row).not.toHaveProperty('color');
  });

  it('hides which color: every choice gives the same ciphertext length', async () => {
    const lengths = new Set<number>();
    for (const color of [undefined, 'red', 'orange', 'gray']) {
      await seed('n1', { metadata_encrypted: undefined });
      await setNoteColor('n1', 'blue'); // ensure a write even for `undefined`
      await setNoteColor('n1', color);
      lengths.add(rows.get('n1')!.metadata_encrypted!.length);
    }
    expect(lengths.size).toBe(1);
  });

  it('clears the color with undefined', async () => {
    await seed('n1');
    await setNoteColor('n1', 'red');

    await setNoteColor('n1', undefined);

    expect(await stored('n1')).not.toHaveProperty('color');
    expect(indexPatch).toHaveBeenLastCalledWith('n1', { color: undefined });
  });

  it('keeps unknown fields from a newer app version', async () => {
    await seed('n1', {
      metadata_encrypted: await encodeNoteMetadata(cryptoManager, {
        tags: [],
        future_field: { a: 1 }
      } as never)
    });

    await setNoteColor('n1', 'pink');

    expect(await stored('n1')).toEqual({ tags: [], future_field: { a: 1 }, color: 'pink' });
  });

  it('is a no-op when the note already has that color', async () => {
    await seed('n1');
    await setNoteColor('n1', 'violet');
    pushNoteMutation.mockClear();

    expect(await setNoteColor('n1', 'violet')).toBe(false);
    expect(pushNoteMutation).not.toHaveBeenCalled();
  });

  it('rejects values outside the palette without writing', async () => {
    await seed('n1');

    await expect(setNoteColor('n1', '#ff0000')).rejects.toThrow();
    await expect(setNoteColor('n1', 'teal')).rejects.toThrow();

    expect(rows.get('n1')!.sync_status).toBe('synced');
    expect(pushNoteMutation).not.toHaveBeenCalled();
  });

  it('rebuilds an undecryptable bundle from the local flags and tag relations', async () => {
    await seed('n1', { metadata_encrypted: 'foreign:ciphertext', is_starred: true });
    localTags.set('n1', [TAG]);

    await setNoteColor('n1', 'yellow');

    expect(await stored('n1')).toEqual({
      is_pinned: true,
      is_starred: true,
      tags: [TAG],
      color: 'yellow'
    });
  });

  it('promotes a pristine new note, like pin and star (#349)', async () => {
    await seed('n1', { is_ephemeral: true, sync_version: 0, sync_status: 'pending' });

    await setNoteColor('n1', 'orange');

    expect(rows.get('n1')!.is_ephemeral).toBe(false);
    expect(pushNoteMutation).toHaveBeenCalledWith(expect.anything(), true, expect.anything());
  });
});

describe('decryptTitleOnly - color for the note index', () => {
  it('decodes the color next to the title', async () => {
    await seed('n1');
    await setNoteColor('n1', 'gray');

    const entry = await decryptTitleOnly(rows.get('n1')!);

    expect(entry).toMatchObject({ title: 'n1 title', color: 'gray', decryptFailed: false });
  });

  it('shows no color for an undecryptable bundle and does not flag the note', async () => {
    await seed('n1', { metadata_encrypted: 'foreign:ciphertext' });

    const entry = await decryptTitleOnly(rows.get('n1')!);

    expect(entry.color).toBeUndefined();
    expect(entry.decryptFailed).toBe(false);
  });

  it('reads a legacy unpadded bundle', async () => {
    await seed('n1', {
      metadata_encrypted: `enc:${JSON.stringify({ is_pinned: false, color: 'blue' })}`
    });

    expect((await decryptTitleOnly(rows.get('n1')!)).color).toBe('blue');
  });
});
