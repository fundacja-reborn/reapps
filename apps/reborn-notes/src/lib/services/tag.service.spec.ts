import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TagEncrypted } from '@reborn/types';

// Undecryptable-row wiring for tags (guideline 63, #15): any failed field
// (name OR color) flags the whole row, the session cache skips re-decryption,
// and a rewritten row is retried. Mirrors saved-search.service.spec.ts.

const rows: TagEncrypted[] = [];
const decryptTextSpy = vi.fn(async (stored: string) => {
  if (stored.startsWith('bad:')) throw new Error('OperationError');
  return stored.replace(/^enc:/, '');
});

vi.mock('@reborn/crypto', () => ({
  cryptoManager: {
    isInitialized: () => true,
    encryptText: async (value: string) => `enc:${value}`,
    decryptText: (stored: string) => decryptTextSpy(stored)
  }
}));

vi.mock('@reborn/storage', () => ({
  tagStore: {
    get: async (id: string) => rows.find((r) => r.id === id) ?? null,
    getAll: async () => [...rows],
    delete: async (id: string) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
    }
  },
  tagOperations: {
    saveTag: async (row: TagEncrypted) => {
      const idx = rows.findIndex((r) => r.id === row.id);
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
    }
  },
  noteTagQueries: {
    getTagsForNote: async () => [],
    getNotesForTag: async () => []
  },
  noteTagOperations: {
    removeAllNotesFromTag: async () => {}
  },
  noteStore: {
    get: async () => null
  }
}));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ userId: 'user-1', isAuthenticated: true }) };
});

vi.mock('./notes-sync.service', () => ({
  pushTag: vi.fn(),
  pushTagUpdate: vi.fn(),
  pushTagDelete: vi.fn(),
  pushNoteUpdate: vi.fn(),
  pushNoteMutation: vi.fn()
}));

vi.mock('$lib/services/note-index.svelte', () => ({
  noteIndex: { get: () => undefined, patch: vi.fn() }
}));

const { getAllTags, renameTag } = await import('./tag.service');

function seed(partial: Partial<TagEncrypted> & { id: string }): TagEncrypted {
  const row: TagEncrypted = {
    user_id: 'user-1',
    name_encrypted: 'enc:Seeded',
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
  decryptTextSpy.mockClear();
  // NOTE: the service keeps a module-scoped session cache of undecryptable
  // rows (keyed by id + updated_at) which survives between tests - seed
  // corrupt rows under ids unique to their test.
});

describe('undecryptable tag rows (foreign key epoch / corruption)', () => {
  it('flags the row and degrades every field when the name does not decrypt', async () => {
    seed({ id: 'ghost-1', name_encrypted: 'bad:name', color_encrypted: 'enc:#ef4444' });

    const [ghost] = await getAllTags();

    expect(ghost!.decrypt_failed).toBe(true);
    expect(ghost!.name).toBe('');
    expect(ghost!.color).toBeUndefined();
  });

  it('flags the row when only the color is corrupt', async () => {
    seed({ id: 'ghost-2', color_encrypted: 'bad:color' });

    const [ghost] = await getAllTags();

    expect(ghost!.decrypt_failed).toBe(true);
    expect(ghost!.name).toBe('');
  });

  it('an absent color is legal - no flag', async () => {
    seed({ id: 'fine-1', name_encrypted: 'enc:Work' });

    const [tag] = await getAllTags();

    expect(tag!.decrypt_failed).toBeUndefined();
    expect(tag!.name).toBe('Work');
    expect(tag!.color).toBeUndefined();
  });

  it('leaves healthy rows unflagged next to a corrupt one', async () => {
    seed({ id: 'ghost-3', name_encrypted: 'bad:name' });
    seed({ id: 'fine-3', name_encrypted: 'enc:Fine' });

    const byId = new Map((await getAllTags()).map((t) => [t.id, t]));

    expect(byId.get('ghost-3')!.decrypt_failed).toBe(true);
    expect(byId.get('fine-3')!.decrypt_failed).toBeUndefined();
    expect(byId.get('fine-3')!.name).toBe('Fine');
  });

  it('does not re-decrypt a known-bad row until its updated_at changes', async () => {
    seed({ id: 'ghost-4', name_encrypted: 'bad:name' });

    await getAllTags();

    decryptTextSpy.mockClear();
    const [stillGhost] = await getAllTags();
    expect(stillGhost!.decrypt_failed).toBe(true);
    expect(decryptTextSpy).not.toHaveBeenCalled();

    // Rewritten row (e.g. repaired from a device holding the right key):
    // retried, decodes normally, sticky entry dropped.
    rows.length = 0;
    seed({ id: 'ghost-4', updated_at: '2026-06-02T00:00:00.000Z' });
    const [repaired] = await getAllTags();
    expect(repaired!.decrypt_failed).toBeUndefined();
    expect(repaired!.name).toBe('Seeded');
  });

  it('rename re-encrypts under the current key (repair path)', async () => {
    seed({ id: 'ghost-5', name_encrypted: 'bad:name' });
    await getAllTags(); // marks the row in the session cache

    await renameTag('ghost-5', 'Recovered');

    const [repaired] = await getAllTags();
    expect(repaired!.decrypt_failed).toBeUndefined();
    expect(repaired!.name).toBe('Recovered');
  });
});
