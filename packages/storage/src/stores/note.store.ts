import { createLogger } from '@reborn/utils';
import { validateEncryptedPayload } from '@reborn/crypto';
import type { IDBPDatabase } from 'idb';
import { getDatabaseIfInitialized, requireDatabase } from '../core/database';
import type { BatchResult, QueryOptions } from '../core/types';
import type {
  BooleanInt,
  NoteContentRow,
  NoteMetaLocal,
  NoteStoredLocal
} from '@reborn/types';
import { boolToInt, intToBool } from '../transformers/boolean';

const logger = createLogger('storage:note-store');

const NOTES_STORE = 'notes';
const CONTENTS_STORE = 'noteContents';

/**
 * Storage representation of the metadata row: shadow-index booleans
 * (is_pinned / is_starred / is_archived) stored as `BooleanInt` (0 | 1) so
 * IndexedDB can index them efficiently. Boolean keys are not reliably indexed
 * across browsers.
 *
 * The public types keep boolean fields - the transformer round-trips them on
 * save / load.
 */
type NoteMetaRaw = Omit<NoteMetaLocal, 'is_pinned' | 'is_starred' | 'is_archived'> & {
  is_pinned?: BooleanInt;
  is_starred?: BooleanInt;
  is_archived?: BooleanInt;
};

function metaToStorage(item: NoteMetaLocal): NoteMetaRaw {
  const result: Record<string, unknown> = { ...item };
  if (typeof item.is_pinned === 'boolean') result.is_pinned = boolToInt(item.is_pinned);
  if (typeof item.is_starred === 'boolean') result.is_starred = boolToInt(item.is_starred);
  if (typeof item.is_archived === 'boolean') result.is_archived = boolToInt(item.is_archived);
  return result as unknown as NoteMetaRaw;
}

function metaFromStorage(item: NoteMetaRaw): NoteMetaLocal {
  const result: Record<string, unknown> = { ...item };
  // Tolerate legacy boolean values from records saved before this transformer
  // existed - only convert when the stored value is the new BooleanInt form.
  if (item.is_pinned === 0 || item.is_pinned === 1) {
    result.is_pinned = intToBool(item.is_pinned);
  }
  if (item.is_starred === 0 || item.is_starred === 1) {
    result.is_starred = intToBool(item.is_starred);
  }
  if (item.is_archived === 0 || item.is_archived === 1) {
    result.is_archived = intToBool(item.is_archived);
  }
  return result as unknown as NoteMetaLocal;
}

/**
 * Join a metadata row with its content row into the full public record.
 * Precedence: the `noteContents` row wins; a legacy v13 row not yet swept by
 * `migrateLegacyContent()` still carries its ciphertext inline on the meta
 * row and must never be masked. The empty-string fallback only applies when
 * neither exists (cannot happen through this store's API - writes are atomic
 * across both stores) - it fails ciphertext decoding downstream, so such a
 * row surfaces as an explicit undecryptable placeholder instead of silently
 * vanishing.
 */
function joinNote(meta: NoteMetaRaw, content: NoteContentRow | undefined): NoteStoredLocal {
  const joined = metaFromStorage(meta) as NoteStoredLocal;
  joined.content_encrypted = content?.content_encrypted ?? joined.content_encrypted ?? '';
  return joined;
}

/**
 * Split a full public record into its two physical rows. The content row is
 * keyed by the same id as the metadata row.
 */
function splitNote(item: NoteStoredLocal): { meta: NoteMetaRaw; content: NoteContentRow } {
  const { content_encrypted, ...metaPublic } = item;
  return {
    meta: metaToStorage(metaPublic),
    content: { id: item.id, content_encrypted }
  };
}

/**
 * Guard against the one content-loss hazard the split introduces: a caller
 * bypassing the types (e.g. spreading a `NoteMetaLocal` and casting) would
 * previously overwrite the full record minus content; now it would write an
 * empty content row. Fail loudly instead - the pre-save Encryption Guard
 * skips absent fields, so this is the only place that can catch it.
 */
function assertHasContent(item: NoteStoredLocal): void {
  if (typeof item.content_encrypted !== 'string') {
    throw new Error(
      `Note ${item.id} is missing content_encrypted - refusing a partial save that would drop the note content`
    );
  }
}

/**
 * Note store for RebornNotes.
 *
 * Since DB v14 a note is physically split across two object stores:
 *   - `notes`        - metadata + `title_encrypted` (+ shadow indexes)
 *   - `noteContents` - `{ id, content_encrypted }`
 *
 * The public API is unchanged for full-record readers and all writers:
 * `get`/`getMany`/`getAll`/`query` join both stores in one transaction and
 * return the complete `NoteStoredLocal`; `save`/`saveMany` validate the full
 * record (Encryption Guard) and write both rows atomically in one
 * `readwrite` transaction; `delete`/`deleteMany`/`clear` cascade to both
 * stores. Metadata-only readers opt into `getAllMeta`/`getManyMeta`, which
 * never deserialize the content blobs - that projection is the point of the
 * split (cold-start note index build, sync reconcile snapshots, pending
 * counts; see reapps-docs guideline 10).
 *
 * Legacy v13 rows (content still inline on the meta row) are tolerated by
 * every joined read and migrated lazily - by `migrateLegacyContent()` and by
 * any save() of the row - so the v14 upgrade itself stays structure-only.
 *
 * Unlike the generic `IndexedDBStore`, this class deliberately has NO
 * `items` writable and NO post-write `refreshItems()`: nothing subscribed to
 * `noteStore.items`, yet every save paid a full-table `getAll()` for it. The
 * notes UI reads the in-memory `noteIndex` instead.
 */
class SplitNoteStore {
  private getDb(): IDBPDatabase | null {
    return getDatabaseIfInitialized();
  }

  /** Shared write-path connection helper - see core/database.ts. */
  private async requireDb(): Promise<IDBPDatabase> {
    return requireDatabase();
  }

  /** Both stores must exist (v14 schema); false during early boot / stale schema. */
  private hasStores(db: IDBPDatabase): boolean {
    return (
      db.objectStoreNames.contains(NOTES_STORE) && db.objectStoreNames.contains(CONTENTS_STORE)
    );
  }

  // ── Metadata-only reads (no content deserialization) ─────────────

  /** All note metadata rows - never touches the `noteContents` blobs. */
  async getAllMeta(): Promise<NoteMetaLocal[]> {
    try {
      const db = this.getDb();
      if (!db || !db.objectStoreNames.contains(NOTES_STORE)) {
        logger.debug('Database or notes store unavailable, returning empty array');
        return [];
      }
      const stored = (await db.getAll(NOTES_STORE)) as NoteMetaRaw[];
      return stored.map(metaFromStorage);
    } catch (error) {
      logger.error('Failed to get all note metadata', { error });
      throw error;
    }
  }

  /** Metadata rows for the given ids (missing ids are skipped). */
  async getManyMeta(ids: string[]): Promise<NoteMetaLocal[]> {
    try {
      const db = this.getDb();
      if (!db || !db.objectStoreNames.contains(NOTES_STORE)) {
        logger.debug('Database or notes store unavailable, returning empty array');
        return [];
      }
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const store = tx.objectStore(NOTES_STORE);
      // Issue all point reads up front - IDB serves them within the one
      // transaction without a per-request microtask round-trip.
      const stored = (await Promise.all(ids.map((id) => store.get(id)))) as Array<
        NoteMetaRaw | undefined
      >;
      await tx.done;
      return stored.filter((s): s is NoteMetaRaw => s !== undefined).map(metaFromStorage);
    } catch (error) {
      logger.error('Failed to get note metadata by ids', { ids, error });
      throw error;
    }
  }

  // ── Full-record reads (join both stores in one transaction) ──────

  async get(id: string): Promise<NoteStoredLocal | null> {
    try {
      const db = this.getDb();
      if (!db || !this.hasStores(db)) {
        logger.debug('Database or note stores unavailable, returning null', { id });
        return null;
      }
      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readonly');
      const meta = (await tx.objectStore(NOTES_STORE).get(id)) as NoteMetaRaw | undefined;
      const content = meta
        ? ((await tx.objectStore(CONTENTS_STORE).get(id)) as NoteContentRow | undefined)
        : undefined;
      await tx.done;
      return meta ? joinNote(meta, content) : null;
    } catch (error) {
      logger.error('Failed to get note', { id, error });
      throw error;
    }
  }

  async getMany(ids: string[]): Promise<NoteStoredLocal[]> {
    try {
      const db = this.getDb();
      if (!db || !this.hasStores(db)) {
        logger.debug('Database or note stores unavailable, returning empty array');
        return [];
      }
      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readonly');
      const notes = tx.objectStore(NOTES_STORE);
      const contents = tx.objectStore(CONTENTS_STORE);
      // Both stores share the id keyspace - issue all reads concurrently.
      const pairs = (await Promise.all(
        ids.map((id) => Promise.all([notes.get(id), contents.get(id)]))
      )) as Array<[NoteMetaRaw | undefined, NoteContentRow | undefined]>;
      await tx.done;
      return pairs
        .filter((pair): pair is [NoteMetaRaw, NoteContentRow | undefined] => pair[0] !== undefined)
        .map(([meta, content]) => joinNote(meta, content));
    } catch (error) {
      logger.error('Failed to get notes by ids', { ids, error });
      throw error;
    }
  }

  async getAll(): Promise<NoteStoredLocal[]> {
    try {
      const db = this.getDb();
      if (!db || !this.hasStores(db)) {
        logger.debug('Database or note stores unavailable, returning empty array');
        return [];
      }
      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readonly');
      const [metas, contents] = await Promise.all([
        tx.objectStore(NOTES_STORE).getAll() as Promise<NoteMetaRaw[]>,
        tx.objectStore(CONTENTS_STORE).getAll() as Promise<NoteContentRow[]>
      ]);
      await tx.done;
      const contentById = new Map(contents.map((c) => [c.id, c]));
      return metas.map((meta) => joinNote(meta, contentById.get(meta.id)));
    } catch (error) {
      logger.error('Failed to get all notes', { error });
      throw error;
    }
  }

  /**
   * Query full records via a metadata index (same index set as before the
   * split - indexes live on the `notes` store). Contents are joined per
   * matched row inside the same transaction.
   */
  async query(index: string, value: unknown, options?: QueryOptions): Promise<NoteStoredLocal[]> {
    try {
      const db = this.getDb();
      if (!db || !this.hasStores(db)) {
        logger.debug('Database or note stores unavailable, returning empty array', {
          index,
          value
        });
        return [];
      }
      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readonly');
      const idx = tx.objectStore(NOTES_STORE).index(index);
      const contents = tx.objectStore(CONTENTS_STORE);

      let cursor = await idx.openCursor(IDBKeyRange.only(value), options?.direction);
      const metas: NoteMetaRaw[] = [];
      let count = 0;
      const offset = options?.offset || 0;
      const limit = options?.limit || Infinity;

      while (cursor) {
        if (count >= offset && metas.length < limit) {
          metas.push(cursor.value as NoteMetaRaw);
        }
        count++;
        if (count >= offset + limit) {
          break;
        }
        cursor = await cursor.continue();
      }

      // Join contents in one concurrent batch after the cursor walk.
      const contentRows = (await Promise.all(metas.map((m) => contents.get(m.id)))) as Array<
        NoteContentRow | undefined
      >;
      await tx.done;
      const results = metas.map((meta, i) => joinNote(meta, contentRows[i]));
      logger.debug('Note query completed', { index, value, count: results.length });
      return results;
    } catch (error) {
      logger.error('Note query failed', { index, value, error });
      throw error;
    }
  }

  // ── Writes (atomic across both stores) ───────────────────────────

  async save(item: NoteStoredLocal): Promise<void> {
    try {
      const db = await this.requireDb();
      assertHasContent(item);
      // Pre-save encryption guard: validate all *_encrypted fields on the FULL
      // record (title + content + metadata) before it is split for storage.
      validateEncryptedPayload(item as unknown as Record<string, unknown>);
      const { meta, content } = splitNote(item);

      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readwrite');
      await Promise.all([
        tx.objectStore(NOTES_STORE).put(meta),
        tx.objectStore(CONTENTS_STORE).put(content)
      ]);
      await tx.done;
      logger.debug('Note saved', { id: item.id });
    } catch (error) {
      logger.error('Failed to save note', {
        id: item.id,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async saveMany(items: NoteStoredLocal[]): Promise<BatchResult> {
    const result: BatchResult = {
      success: 0,
      failed: 0,
      errors: []
    };

    try {
      const db = await this.requireDb();
      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readwrite');
      const notes = tx.objectStore(NOTES_STORE);
      const contents = tx.objectStore(CONTENTS_STORE);

      for (const item of items) {
        try {
          assertHasContent(item);
          validateEncryptedPayload(item as unknown as Record<string, unknown>);
          const { meta, content } = splitNote(item);
          await Promise.all([notes.put(meta), contents.put(content)]);
          result.success++;
        } catch (error) {
          result.failed++;
          result.errors.push(error as Error);
          logger.error('Failed to save note in batch', { id: item.id, error });
        }
      }

      await tx.done;
      logger.info('Note batch save completed', {
        success: result.success,
        failed: result.failed
      });
      return result;
    } catch (error) {
      logger.error('Note batch save failed', { error });
      throw error;
    }
  }

  // ── Deletes (cascade to both stores) ─────────────────────────────

  async delete(id: string): Promise<void> {
    try {
      const db = await this.requireDb();
      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readwrite');
      await Promise.all([
        tx.objectStore(NOTES_STORE).delete(id),
        tx.objectStore(CONTENTS_STORE).delete(id)
      ]);
      await tx.done;
      logger.debug('Note deleted', { id });
    } catch (error) {
      logger.error('Failed to delete note', { id, error });
      throw error;
    }
  }

  async deleteMany(ids: string[]): Promise<void> {
    const result: BatchResult = {
      success: 0,
      failed: 0,
      errors: []
    };

    try {
      const db = await this.requireDb();
      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readwrite');
      const notes = tx.objectStore(NOTES_STORE);
      const contents = tx.objectStore(CONTENTS_STORE);

      for (const id of ids) {
        try {
          await Promise.all([notes.delete(id), contents.delete(id)]);
          result.success++;
        } catch (error) {
          result.failed++;
          result.errors.push(error as Error);
          logger.error('Failed to delete note in batch', { id, error });
        }
      }

      await tx.done;
      logger.info('Note batch delete completed', {
        success: result.success,
        failed: result.failed
      });
    } catch (error) {
      logger.error('Note batch delete failed', { error });
      throw error;
    }
  }

  /** Wipe both stores (logout / account switch - see clearAllUserData). */
  async clear(): Promise<void> {
    try {
      const db = await this.requireDb();
      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readwrite');
      await Promise.all([
        tx.objectStore(NOTES_STORE).clear(),
        tx.objectStore(CONTENTS_STORE).clear()
      ]);
      await tx.done;
      logger.info('Note stores cleared');
    } catch (error) {
      logger.error('Failed to clear note stores', { error });
      throw error;
    }
  }

  // ── Legacy content sweep (post-v14 upgrade) ──────────────────────

  /**
   * Move `content_encrypted` ciphertext still stored inline on legacy (pre-v14)
   * `notes` rows into `noteContents`. The v14 upgrade itself is structure-only
   * (it just creates the store), so it can never fail on data volume; this
   * sweep does the data move AFTER the database is open, in small independent
   * readwrite transactions:
   *
   * - chunked: a quota or transient error aborts only the current chunk, the
   *   app keeps working (joined reads prefer the inline legacy ciphertext, see
   *   joinNote) and the next run resumes where it stopped;
   * - idempotent: each row is re-checked inside its transaction, so a
   *   concurrent save() that already split the row is skipped;
   * - self-healing by construction: every save() writes the split shape, so
   *   rows migrate organically even if the sweep never completes.
   *
   * Returns the number of rows moved this run. Callers gate it behind a
   * once-per-profile flag (see reborn-notes hooks.client.ts).
   */
  async migrateLegacyContent(chunkSize = 50): Promise<number> {
    const db = this.getDb();
    if (!db || !this.hasStores(db)) return 0;

    // Pass 1 (readonly): collect ids of rows still carrying inline content.
    const legacyIds: string[] = [];
    {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      let cursor = await tx.objectStore(NOTES_STORE).openCursor();
      while (cursor) {
        const row = cursor.value as { id: string; content_encrypted?: unknown };
        if (typeof row.content_encrypted === 'string') legacyIds.push(row.id);
        cursor = await cursor.continue();
      }
      await tx.done;
    }
    if (legacyIds.length === 0) return 0;

    // Pass 2: move in chunks, one readwrite transaction per chunk.
    let moved = 0;
    for (let i = 0; i < legacyIds.length; i += chunkSize) {
      const chunk = legacyIds.slice(i, i + chunkSize);
      const tx = db.transaction([NOTES_STORE, CONTENTS_STORE], 'readwrite');
      const notes = tx.objectStore(NOTES_STORE);
      const contents = tx.objectStore(CONTENTS_STORE);
      for (const id of chunk) {
        const row = (await notes.get(id)) as
          | { id: string; content_encrypted?: unknown }
          | undefined;
        if (!row || typeof row.content_encrypted !== 'string') continue;
        await contents.put({ id: row.id, content_encrypted: row.content_encrypted });
        delete row.content_encrypted;
        await notes.put(row);
        moved++;
      }
      await tx.done;
      // Yield between chunks - keep the boot-time main thread responsive.
      await new Promise((r) => setTimeout(r, 0));
    }
    logger.info('Moved legacy inline note content into noteContents', {
      moved,
      total: legacyIds.length
    });
    return moved;
  }

  // ── Counts ───────────────────────────────────────────────────────

  async count(): Promise<number> {
    try {
      const db = this.getDb();
      if (!db || !db.objectStoreNames.contains(NOTES_STORE)) {
        logger.debug('Database or notes store unavailable, returning 0');
        return 0;
      }
      try {
        return await db.count(NOTES_STORE);
      } catch (countError) {
        logger.debug('Note count operation failed, returning 0', { error: countError });
        return 0;
      }
    } catch (error) {
      logger.error('Failed to count notes', { error });
      // Don't throw for count operations - return 0 instead
      return 0;
    }
  }
}

/**
 * Note store for RebornNotes application. See `SplitNoteStore` for the
 * physical two-store layout behind the unchanged public record shape.
 */
export const noteStore = new SplitNoteStore();

/**
 * Helper queries for notes
 */
export const noteQueries = {
  /**
   * Get all active notes (not deleted)
   */
  getActive: async (): Promise<NoteStoredLocal[]> => {
    const all = await noteStore.getAll();
    return all.filter(note => !note.is_archived);
  },

  /**
   * Get notes by folder
   */
  byFolder: async (folderId: string | null): Promise<NoteStoredLocal[]> => {
    if (folderId === null) {
      // Root level notes
      const all = await noteStore.getAll();
      return all.filter(note => !note.folder_id && !note.is_archived);
    }
    const notes = await noteStore.query('folder_id', folderId);
    return notes.filter(note => !note.is_archived);
  },

  /**
   * Get active notes belonging to any of the given folders. Empty array → no matches.
   * De-duplicates by note id (the same note never lives in two folders, but the
   * store guarantees nothing about overlapping IDs across query() calls).
   */
  byFolders: async (folderIds: string[]): Promise<NoteStoredLocal[]> => {
    if (folderIds.length === 0) return [];
    const results = await Promise.all(
      folderIds.map(id => noteStore.query('folder_id', id))
    );
    const seen = new Set<string>();
    const merged: NoteStoredLocal[] = [];
    for (const batch of results) {
      for (const note of batch) {
        if (note.is_archived || seen.has(note.id)) continue;
        seen.add(note.id);
        merged.push(note);
      }
    }
    return merged;
  },

  /**
   * Get pinned notes
   */
  getPinned: async (): Promise<NoteStoredLocal[]> => {
    // IndexedDB does not support boolean keys in indexes, so we filter in memory
    const all = await noteStore.getAll();
    return all.filter(note => note.is_pinned && !note.is_archived);
  },



  /**
   * Get archived notes
   */
  getArchived: async (): Promise<NoteStoredLocal[]> => {
    // IndexedDB does not support boolean keys in indexes, so we filter in memory
    const all = await noteStore.getAll();
    return all.filter(note => note.is_archived);
  },

  /**
   * Get recently updated notes
   */
  getRecent: async (limit = 10): Promise<NoteStoredLocal[]> => {
    const notes = await noteQueries.getActive();
    return notes
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit);
  }
};

/**
 * Note operations
 */
export const noteOperations = {
  /**
   * Archive a note
   */
  archive: async (noteId: string): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      is_archived: true,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Unarchive a note
   */
  unarchive: async (noteId: string): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      is_archived: false,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Toggle pin status
   */
  togglePin: async (noteId: string): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      is_pinned: !note.is_pinned,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Toggle star status
   */
  toggleStar: async (noteId: string): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      is_starred: !note.is_starred,
      updated_at: new Date().toISOString()
    });
  },



  /**
   * Move note to folder
   */
  moveToFolder: async (noteId: string, folderId: string | null): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      folder_id: folderId ?? undefined,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Permanently delete archived notes older than specified days
   */
  cleanArchived: async (daysOld = 90): Promise<number> => {
    const archived = await noteQueries.getArchived();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const toDelete = archived.filter(note => {
      return new Date(note.updated_at) < cutoffDate;
    });

    await noteStore.deleteMany(toDelete.map(n => n.id));
    return toDelete.length;
  }
};
