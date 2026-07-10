import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteStoredLocal } from '@reborn/types';

/**
 * Unit tests for the DB v14 note content split (`SplitNoteStore` in
 * stores/note.store.ts): joined full reads (including the legacy-inline
 * precedence), metadata-only reads, atomic dual-store writes, cascading
 * deletes/clear, the partial-save guard, and the chunked
 * `migrateLegacyContent()` sweep that moves pre-v14 inline content into
 * `noteContents` after the (structure-only) upgrade.
 *
 * IndexedDB is stubbed with a minimal in-memory implementation of the exact
 * `idb` surface the store uses (fake-indexeddb is not a workspace dependency).
 * The stub clones values on the way in and out, mirroring the structured
 * clone IndexedDB performs.
 */

// ── In-memory IDB stub ─────────────────────────────────────────────

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class StubObjectStore {
  data = new Map<string, Record<string, unknown>>();
  constructor(private indexKeyPaths: Record<string, string> = {}) {}

  async get(id: string) {
    return clone(this.data.get(id));
  }
  async getAll() {
    return Array.from(this.data.values()).map(clone);
  }
  async put(value: Record<string, unknown>) {
    this.data.set(value.id as string, clone(value));
    return value.id;
  }
  async delete(id: string) {
    this.data.delete(id);
  }
  async clear() {
    this.data.clear();
  }
  async count() {
    return this.data.size;
  }

  index(name: string) {
    const keyPath = this.indexKeyPaths[name];
    if (!keyPath) throw new Error(`Stub index not defined: ${name}`);
    const matching = (value: unknown) =>
      Array.from(this.data.values()).filter((row) => row[keyPath] === value);
    return {
      openCursor: async (range: { __only: unknown } | null) => {
        const rows = matching(range ? range.__only : undefined).map(clone);
        return makeCursor(rows);
      }
    };
  }

  async openCursor() {
    const rows = Array.from(this.data.values()).map(clone);
    let i = 0;
    const next = (): StubCursor | null =>
      i < rows.length
        ? {
            value: rows[i],
            update: async (v: Record<string, unknown>) => {
              this.data.set(rows[i].id as string, clone(v));
            },
            continue: async () => {
              i++;
              return next();
            }
          }
        : null;
    return next();
  }
}

interface StubCursor {
  value: Record<string, unknown>;
  update: (v: Record<string, unknown>) => Promise<void>;
  continue: () => Promise<StubCursor | null>;
}

function makeCursor(rows: Record<string, unknown>[]): StubCursor | null {
  let i = 0;
  const next = (): StubCursor | null =>
    i < rows.length
      ? {
          value: rows[i],
          update: async () => undefined,
          continue: async () => {
            i++;
            return next();
          }
        }
      : null;
  return next();
}

class StubDb {
  stores: Record<string, StubObjectStore>;
  constructor(stores: Record<string, StubObjectStore>) {
    this.stores = stores;
  }
  get objectStoreNames() {
    const names = Object.keys(this.stores);
    return {
      contains: (n: string) => names.includes(n),
      [Symbol.iterator]: () => names[Symbol.iterator]()
    };
  }
  transaction(...args: unknown[]) {
    void args;
    return {
      objectStore: (n: string) => this.stores[n],
      done: Promise.resolve(),
      db: this
    };
  }
  async getAll(storeName: string) {
    return this.stores[storeName].getAll();
  }
  async count(storeName: string) {
    return this.stores[storeName].count();
  }
}

let stubDb: StubDb;

vi.mock('../core/database', () => ({
  databaseManager: {
    isInitialized: () => stubDb !== undefined,
    getDatabase: () => stubDb,
    reconnect: async () => stubDb
  },
  getDatabaseIfInitialized: () => stubDb ?? null,
  requireDatabase: async () => stubDb
}));

// Simplified mirror of the real iv:ciphertext validation (see
// encrypted-fields-guard.spec.ts) - enough to prove the store calls it on the
// FULL record before splitting.
vi.mock('@reborn/crypto', () => ({
  validateEncryptedPayload: vi.fn((data: Record<string, unknown>) => {
    for (const key of Object.keys(data)) {
      if (!key.endsWith('_encrypted')) continue;
      const value = data[key];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string' || value.split(':').length !== 2) {
        throw new Error(`Encryption guard: invalid encrypted format (field: ${key}).`);
      }
    }
  })
}));

// The store builds IDBKeyRange.only() ranges; jsdom has no IndexedDB.
(globalThis as Record<string, unknown>).IDBKeyRange = {
  only: (v: unknown) => ({ __only: v })
};

import { noteStore } from '../stores/note.store';
import { getDatabaseConfig } from '../stores/base.store';

const VALID_ENCRYPTED = 'dGVzdGl2MTIzNDU2:Y2lwaGVydGV4dGRhdGE=';

function makeNote(id: string, overrides: Partial<NoteStoredLocal> = {}): NoteStoredLocal {
  return {
    id,
    title_encrypted: VALID_ENCRYPTED,
    content_encrypted: VALID_ENCRYPTED,
    sync_status: 'pending',
    sync_version: 0,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides
  } as NoteStoredLocal;
}

function freshDb() {
  stubDb = new StubDb({
    notes: new StubObjectStore({ folder_id: 'folder_id' }),
    noteContents: new StubObjectStore()
  });
}

beforeEach(() => {
  freshDb();
});

describe('SplitNoteStore', () => {
  it('save() writes the meta row without content and the content row separately', async () => {
    await noteStore.save(makeNote('n1', { is_pinned: true }));

    const metaRaw = stubDb.stores.notes.data.get('n1')!;
    expect(metaRaw).not.toHaveProperty('content_encrypted');
    expect(metaRaw.title_encrypted).toBe(VALID_ENCRYPTED);
    // BooleanInt shadow index on the physical row
    expect(metaRaw.is_pinned).toBe(1);

    const contentRaw = stubDb.stores.noteContents.data.get('n1')!;
    expect(contentRaw).toEqual({ id: 'n1', content_encrypted: VALID_ENCRYPTED });
  });

  it('get() joins both rows back into the full public record', async () => {
    await noteStore.save(makeNote('n1', { is_pinned: true, is_starred: false }));

    const note = await noteStore.get('n1');
    expect(note).not.toBeNull();
    expect(note!.content_encrypted).toBe(VALID_ENCRYPTED);
    expect(note!.title_encrypted).toBe(VALID_ENCRYPTED);
    // Booleans round-trip through the BooleanInt transformer
    expect(note!.is_pinned).toBe(true);
    expect(note!.is_starred).toBe(false);
  });

  it('get() returns null for a missing id', async () => {
    expect(await noteStore.get('absent')).toBeNull();
  });

  it('getAll() joins every row; getMany() joins the requested ids only', async () => {
    await noteStore.save(makeNote('n1'));
    await noteStore.save(makeNote('n2'));

    const all = await noteStore.getAll();
    expect(all).toHaveLength(2);
    for (const n of all) expect(n.content_encrypted).toBe(VALID_ENCRYPTED);

    const many = await noteStore.getMany(['n2', 'absent']);
    expect(many).toHaveLength(1);
    expect(many[0].id).toBe('n2');
    expect(many[0].content_encrypted).toBe(VALID_ENCRYPTED);
  });

  it('getAllMeta()/getManyMeta() never carry content_encrypted', async () => {
    await noteStore.save(makeNote('n1', { is_archived: true }));
    await noteStore.save(makeNote('n2'));

    const metas = await noteStore.getAllMeta();
    expect(metas).toHaveLength(2);
    for (const m of metas) {
      expect(m).not.toHaveProperty('content_encrypted');
      expect(m.title_encrypted).toBe(VALID_ENCRYPTED);
    }
    // Booleans still round-trip on the meta projection
    expect(metas.find((m) => m.id === 'n1')!.is_archived).toBe(true);

    const some = await noteStore.getManyMeta(['n1', 'absent']);
    expect(some).toHaveLength(1);
    expect(some[0]).not.toHaveProperty('content_encrypted');
  });

  it('save() refuses a record without content_encrypted and writes nothing', async () => {
    const partial = { ...makeNote('n1') } as Record<string, unknown>;
    delete partial.content_encrypted;

    await expect(noteStore.save(partial as unknown as NoteStoredLocal)).rejects.toThrow(
      /missing content_encrypted/
    );
    expect(stubDb.stores.notes.data.size).toBe(0);
    expect(stubDb.stores.noteContents.data.size).toBe(0);
  });

  it('save() runs the encryption guard on the FULL record before splitting', async () => {
    await expect(
      noteStore.save(makeNote('n1', { content_encrypted: 'plaintext, no colon' }))
    ).rejects.toThrow(/Encryption guard/);
    expect(stubDb.stores.notes.data.size).toBe(0);
    expect(stubDb.stores.noteContents.data.size).toBe(0);
  });

  it('saveMany() keeps valid items and counts invalid ones as failed', async () => {
    const bad = { ...makeNote('bad') } as Record<string, unknown>;
    delete bad.content_encrypted;

    const result = await noteStore.saveMany([
      makeNote('ok1'),
      bad as unknown as NoteStoredLocal,
      makeNote('ok2')
    ]);

    expect(result.success).toBe(2);
    expect(result.failed).toBe(1);
    expect(stubDb.stores.notes.data.has('ok1')).toBe(true);
    expect(stubDb.stores.notes.data.has('ok2')).toBe(true);
    expect(stubDb.stores.notes.data.has('bad')).toBe(false);
    expect(stubDb.stores.noteContents.data.has('bad')).toBe(false);
  });

  it('delete()/deleteMany() cascade to the content store', async () => {
    await noteStore.saveMany([makeNote('n1'), makeNote('n2'), makeNote('n3')]);

    await noteStore.delete('n1');
    expect(stubDb.stores.notes.data.has('n1')).toBe(false);
    expect(stubDb.stores.noteContents.data.has('n1')).toBe(false);

    await noteStore.deleteMany(['n2', 'n3']);
    expect(stubDb.stores.notes.data.size).toBe(0);
    expect(stubDb.stores.noteContents.data.size).toBe(0);
  });

  it('clear() wipes both stores', async () => {
    await noteStore.saveMany([makeNote('n1'), makeNote('n2')]);
    await noteStore.clear();
    expect(stubDb.stores.notes.data.size).toBe(0);
    expect(stubDb.stores.noteContents.data.size).toBe(0);
  });

  it('query() joins content for index-matched rows', async () => {
    await noteStore.save(makeNote('n1', { folder_id: 'f1' }));
    await noteStore.save(makeNote('n2', { folder_id: 'f2' }));

    const inF1 = await noteStore.query('folder_id', 'f1');
    expect(inF1).toHaveLength(1);
    expect(inF1[0].id).toBe('n1');
    expect(inF1[0].content_encrypted).toBe(VALID_ENCRYPTED);
  });

  it('count() counts metadata rows', async () => {
    await noteStore.saveMany([makeNote('n1'), makeNote('n2')]);
    expect(await noteStore.count()).toBe(2);
  });

  it('joins a (never-expected) missing content row as an empty ciphertext instead of dropping the note', async () => {
    await noteStore.save(makeNote('n1'));
    stubDb.stores.noteContents.data.delete('n1');

    const note = await noteStore.get('n1');
    expect(note).not.toBeNull();
    expect(note!.content_encrypted).toBe('');
  });
});

describe('legacy v13 rows (content still inline on the meta row)', () => {
  function seedLegacyRow(id: string, extra: Record<string, unknown> = {}) {
    stubDb.stores.notes.data.set(id, {
      id,
      title_encrypted: VALID_ENCRYPTED,
      content_encrypted: `${id}-content:cipher`,
      updated_at: '2026-07-01T00:00:00.000Z',
      ...extra
    });
  }

  it('joined reads prefer the inline legacy ciphertext over the empty-string fallback', async () => {
    seedLegacyRow('legacy');

    const viaGet = await noteStore.get('legacy');
    expect(viaGet!.content_encrypted).toBe('legacy-content:cipher');

    const viaGetAll = await noteStore.getAll();
    expect(viaGetAll[0].content_encrypted).toBe('legacy-content:cipher');
  });

  it('save() of a legacy row self-heals it into the split shape', async () => {
    seedLegacyRow('legacy');

    const full = await noteStore.get('legacy');
    await noteStore.save({ ...full!, content_encrypted: VALID_ENCRYPTED });

    expect(stubDb.stores.notes.data.get('legacy')).not.toHaveProperty('content_encrypted');
    expect(stubDb.stores.noteContents.data.get('legacy')).toEqual({
      id: 'legacy',
      content_encrypted: VALID_ENCRYPTED
    });
  });

  describe('migrateLegacyContent sweep', () => {
    it('moves inline content into noteContents and strips it from the meta row', async () => {
      seedLegacyRow('a', { is_pinned: 1 });
      seedLegacyRow('b');

      const moved = await noteStore.migrateLegacyContent();

      expect(moved).toBe(2);
      for (const id of ['a', 'b']) {
        const meta = stubDb.stores.notes.data.get(id)!;
        expect(meta).not.toHaveProperty('content_encrypted');
        expect(meta.title_encrypted).toBe(VALID_ENCRYPTED);
        expect(stubDb.stores.noteContents.data.get(id)).toEqual({
          id,
          content_encrypted: `${id}-content:cipher`
        });
      }
      // Shadow index untouched by the move
      expect(stubDb.stores.notes.data.get('a')!.is_pinned).toBe(1);
    });

    it('works chunked and is idempotent (second run is a no-op)', async () => {
      seedLegacyRow('a');
      seedLegacyRow('b');
      seedLegacyRow('c');

      expect(await noteStore.migrateLegacyContent(1)).toBe(3);
      expect(stubDb.stores.noteContents.data.size).toBe(3);
      expect(await noteStore.migrateLegacyContent(1)).toBe(0);
    });

    it('skips rows already in the split shape', async () => {
      await noteStore.save(makeNote('split'));
      seedLegacyRow('legacy');

      const moved = await noteStore.migrateLegacyContent();

      expect(moved).toBe(1);
      expect(stubDb.stores.noteContents.data.get('split')!.content_encrypted).toBe(
        VALID_ENCRYPTED
      );
    });
  });
});

describe('getDatabaseConfig noteContents wiring', () => {
  it('notes config contains the noteContents store; task config does not', () => {
    const notesStores = getDatabaseConfig('notes').stores.map((s) => s.name);
    const taskStores = getDatabaseConfig('task').stores.map((s) => s.name);
    expect(notesStores).toContain('noteContents');
    expect(taskStores).not.toContain('noteContents');
  });
});
