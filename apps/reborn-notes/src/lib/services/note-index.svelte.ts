/**
 * NoteIndex — in-memory cache of decrypted note metadata for list views.
 *
 * Security: RAM-only, NEVER persisted to IndexedDB/localStorage/sessionStorage.
 * Cleared on lock/logout. Rebuilt after sync.
 * ~2 MB for 10K notes (vs ~50 MB full decrypt with content).
 *
 * Consumers: NoteList, NotePicker, autocomplete [[, resolveNoteTitle(), search sidebar.
 *
 * Replaces the old NoteTitleIndex — now stores all metadata needed for list rendering:
 * title, folderId, isPinned, isStarred, isArchived, createdAt, updatedAt, tagIds.
 * Full content is NEVER stored here — loaded on demand by note-detail.service.
 */
import { noteStore, noteTagStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { decryptTitleOnly } from './note.service';
import type { NoteDecrypted } from '@reborn/types';
import { evaluate, type QueryAST, type SearchContext, type SearchEntity } from '@reborn/utils';

export interface NoteIndexEntry {
  title: string;
  folderId: string | undefined;
  isPinned: boolean;
  isStarred: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
}

/** Lightweight note type for list views — NoteDecrypted minus content. */
export type NoteListItem = Omit<NoteDecrypted, 'content' | 'deleted_at'>;

export type SortBy = 'updated_at' | 'created_at' | 'title';

export interface FilterOptions {
  folderId?: string | null;
  /**
   * Restrict to a set of folder IDs (e.g. a folder + all its descendants).
   * Takes precedence over `folderId` when both are provided. Empty array → no matches.
   */
  folderIds?: string[];
  tagId?: string;
  starred?: boolean;
  archived?: boolean;
  search?: string;
  sortBy?: SortBy;
  page?: number;
  pageSize?: number;
}

export interface FilterResult {
  items: NoteListItem[];
  total: number;
  hasMore: boolean;
}

/**
 * AST-driven filter options. Mirrors the pre-filter slice of FilterOptions
 * (folder/tag/starred/archived) — body content is NOT handled here. Operators
 * that need decrypted content (`has:link`, freetext-in-body) are evaluated by
 * the content-search path in `notes.store.ts`, which streams one body at a
 * time through the bare `evaluate()` + `toSearchEntity()` helpers.
 */
export interface FilterByAstOptions {
  folderId?: string | null;
  folderIds?: string[];
  tagId?: string;
  starred?: boolean;
  archived?: boolean;
  sortBy?: SortBy;
  page?: number;
  pageSize?: number;
}

const BATCH_SIZE = 100;

class NoteIndex {
  /** Internal map — NOT reactive on purpose; we bump _version to signal changes. */
  private _map = new Map<string, NoteIndexEntry>();

  /** Svelte 5 reactive version counter — consumers that read derived data re-render. */
  private _version = $state(0);

  private _building = $state(false);

  // ── Bulk operations ────────────────────────────────────────────

  /** Build the cache from scratch (after unlock). Non-blocking — processes in batches. */
  async build(): Promise<void> {
    if (!cryptoManager.isInitialized()) return;
    this._building = true;
    try {
      const allEncrypted = await noteStore.getAll();
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local temp variable, not reactive state
      const map = new Map<string, NoteIndexEntry>();

      // Bulk-load all note-tag relations (avoids N+1 queries)
      const allRelations = await noteTagStore.getAll();
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local temp variable, not reactive state
      const tagMap = new Map<string, string[]>();
      for (const rel of allRelations) {
        const arr = tagMap.get(rel.note_id) ?? [];
        arr.push(rel.tag_id);
        tagMap.set(rel.note_id, arr);
      }

      for (let i = 0; i < allEncrypted.length; i += BATCH_SIZE) {
        const batch = allEncrypted.slice(i, i + BATCH_SIZE);
        const entries = await Promise.all(batch.map(decryptTitleOnly));
        for (const e of entries) {
          map.set(e.id, {
            title: e.title,
            folderId: e.folderId,
            isPinned: e.isPinned,
            isStarred: e.isStarred,
            isArchived: e.isArchived,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
            tagIds: tagMap.get(e.id) ?? []
          });
        }
        // Yield to event loop between batches
        await new Promise((r) => setTimeout(r, 0));
      }

      this._map = map;
      this._version++;
    } finally {
      this._building = false;
    }
  }

  /** Clear and rebuild (after sync). */
  async rebuild(): Promise<void> {
    this._map.clear();
    this._version++;
    await this.build();
  }

  /** Wipe cache (lock / logout). */
  clear(): void {
    this._map.clear();
    this._version++;
  }

  // ── Incremental updates ────────────────────────────────────────

  update(id: string, entry: NoteIndexEntry): void {
    this._map.set(id, entry);
    this._version++;
  }

  /** Partial update — merges with existing entry. */
  patch(id: string, partial: Partial<NoteIndexEntry>): void {
    const existing = this._map.get(id);
    if (!existing) return;
    this._map.set(id, { ...existing, ...partial });
    this._version++;
  }

  remove(id: string): void {
    if (this._map.delete(id)) {
      this._version++;
    }
  }

  // ── Read API (backward-compatible with NoteTitleIndex) ─────────

  /** All non-archived titles sorted by updatedAt desc. Reactive via _version. */
  getAll(): { id: string; title: string }[] {
    void this._version;
    return Array.from(this._map.entries())
      .filter(([, e]) => !e.isArchived)
      .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
      .map(([id, e]) => ({ id, title: e.title }));
  }

  /** Get a single title by id. Reactive. */
  getTitle(id: string): string | undefined {
    void this._version;
    return this._map.get(id)?.title;
  }

  /** Get a single entry by id. Reactive. */
  get(id: string): NoteIndexEntry | undefined {
    void this._version;
    return this._map.get(id);
  }

  /** Instant substring search across titles (sync). Reactive. */
  search(query: string): { id: string; title: string }[] {
    void this._version;
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return Array.from(this._map.entries())
      .filter(([, e]) => !e.isArchived && e.title.toLowerCase().includes(q))
      .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
      .map(([id, e]) => ({ id, title: e.title }));
  }

  /** Total number of entries (including archived). Reactive. */
  get count(): number {
    void this._version;
    return this._map.size;
  }

  /**
   * Snapshot of all non-archived entries for dedup / lookup callers (e.g.
   * the markdown import pipeline). Returns a new array each call — safe
   * to mutate. Excludes archived notes; importer should not collide with
   * trashed titles.
   */
  entries(): { id: string; title: string; folderId: string | undefined }[] {
    void this._version;
    const out: { id: string; title: string; folderId: string | undefined }[] = [];
    for (const [id, e] of this._map) {
      if (e.isArchived) continue;
      out.push({ id, title: e.title, folderId: e.folderId });
    }
    return out;
  }

  /** Whether build() is in progress. */
  get isBuilding(): boolean {
    return this._building;
  }

  // ── Filtered list API ──────────────────────────────────────────

  /**
   * Unified filtering + sorting + pagination over the in-memory index.
   *
   * All operations are synchronous on the Map — no IndexedDB hit, no decryption.
   * Typical cost: <1ms for 10K entries.
   */
  getFiltered(options: FilterOptions = {}): FilterResult {
    void this._version;

    const {
      folderId,
      folderIds,
      tagId,
      starred,
      archived = false,
      search,
      sortBy = 'updated_at',
      page = 1,
      pageSize = 50
    } = options;

    // 1. Filter
    let entries = Array.from(this._map.entries());

    // archived filter
    entries = entries.filter(([, e]) => e.isArchived === archived);

    // folder filter — folderIds (set) takes precedence over folderId (single)
    if (folderIds !== undefined) {
      const set = new Set(folderIds);
      entries = entries.filter(([, e]) => e.folderId !== undefined && set.has(e.folderId));
    } else if (folderId !== undefined) {
      // null = root/no folder, undefined = all
      if (folderId === null) {
        entries = entries.filter(([, e]) => !e.folderId);
      } else {
        entries = entries.filter(([, e]) => e.folderId === folderId);
      }
    }

    // tag filter
    if (tagId) {
      entries = entries.filter(([, e]) => e.tagIds.includes(tagId));
    }

    // starred filter
    if (starred) {
      entries = entries.filter(([, e]) => e.isStarred);
    }

    // title search
    if (search?.trim()) {
      const q = search.toLowerCase();
      entries = entries.filter(([, e]) => e.title.toLowerCase().includes(q));
    }

    // 2. Sort (pinned always first, then by sort key)
    entries.sort((a, b) => {
      // Pinned first (skip in archived/trash mode — no pin concept)
      if (!archived) {
        if (a[1].isPinned && !b[1].isPinned) return -1;
        if (!a[1].isPinned && b[1].isPinned) return 1;
      }

      if (sortBy === 'title') {
        return a[1].title.localeCompare(b[1].title, undefined, { sensitivity: 'base' });
      }
      const aTime = sortBy === 'created_at' ? a[1].createdAt : a[1].updatedAt;
      const bTime = sortBy === 'created_at' ? b[1].createdAt : b[1].updatedAt;
      return bTime.localeCompare(aTime); // desc (newest first)
    });

    const total = entries.length;

    // 3. Paginate
    const start = (page - 1) * pageSize;
    const paged = entries.slice(start, start + pageSize);

    // 4. Convert to NoteListItem
    const items: NoteListItem[] = paged.map(([id, e]) => ({
      id,
      title: e.title,
      folder_id: e.folderId,
      is_pinned: e.isPinned,
      is_starred: e.isStarred,
      is_archived: e.isArchived,
      created_at: e.createdAt,
      updated_at: e.updatedAt,
      tags: e.tagIds
    }));

    return {
      items,
      total,
      hasMore: start + pageSize < total
    };
  }

  /**
   * AST-driven filtering over the in-memory index.
   *
   * Pre-filter (folder/tag/starred/archived) narrows the candidate set, then
   * each remaining entry is mapped to a SearchEntity (with `body = undefined`)
   * and evaluated against the AST. Operators that require content
   * (`has:link`, freetext-in-body) are NOT served here — the caller must take
   * the body-aware path in `notes.store.ts → triggerContentSearch`.
   *
   * Operator → entity mapping for notes:
   *   - `is:starred`  → `entity.flags.starred = entry.isStarred`
   *   - `is:pinned`   → `entity.flags.pinned  = entry.isPinned`
   *   - `is:completed`/`is:overdue`/`due:`     → always false (notes have no completion/due semantics)
   *   - `list:`       → always false (notes have no lists)
   *
   * The active/trash split is handled by the `archived` pre-filter above —
   * there is no public `is:trashed` operator.
   */
  getFilteredByAst(
    ast: QueryAST,
    ctx: SearchContext,
    options: FilterByAstOptions = {}
  ): FilterResult {
    void this._version;

    const {
      folderId,
      folderIds,
      tagId,
      starred,
      archived = false,
      sortBy = 'updated_at',
      page = 1,
      pageSize = 50
    } = options;

    let entries = Array.from(this._map.entries());

    entries = entries.filter(([, e]) => e.isArchived === archived);

    if (folderIds !== undefined) {
      const set = new Set(folderIds);
      entries = entries.filter(([, e]) => e.folderId !== undefined && set.has(e.folderId));
    } else if (folderId !== undefined) {
      if (folderId === null) {
        entries = entries.filter(([, e]) => !e.folderId);
      } else {
        entries = entries.filter(([, e]) => e.folderId === folderId);
      }
    }

    if (tagId) {
      entries = entries.filter(([, e]) => e.tagIds.includes(tagId));
    }

    if (starred) {
      entries = entries.filter(([, e]) => e.isStarred);
    }

    entries = entries.filter(([id, e]) => evaluate(ast, toSearchEntity(id, e), ctx));

    entries.sort((a, b) => {
      if (!archived) {
        if (a[1].isPinned && !b[1].isPinned) return -1;
        if (!a[1].isPinned && b[1].isPinned) return 1;
      }
      if (sortBy === 'title') {
        return a[1].title.localeCompare(b[1].title, undefined, { sensitivity: 'base' });
      }
      const aTime = sortBy === 'created_at' ? a[1].createdAt : a[1].updatedAt;
      const bTime = sortBy === 'created_at' ? b[1].createdAt : b[1].updatedAt;
      return bTime.localeCompare(aTime);
    });

    const total = entries.length;
    const start = (page - 1) * pageSize;
    const paged = entries.slice(start, start + pageSize);

    const items: NoteListItem[] = paged.map(([id, e]) => ({
      id,
      title: e.title,
      folder_id: e.folderId,
      is_pinned: e.isPinned,
      is_starred: e.isStarred,
      is_archived: e.isArchived,
      created_at: e.createdAt,
      updated_at: e.updatedAt,
      tags: e.tagIds
    }));

    return { items, total, hasMore: start + pageSize < total };
  }
}

/**
 * Map a NoteIndexEntry to the SearchEntity shape consumed by `evaluate()`.
 * Exported so the body-aware content-search path in `notes.store.ts` can
 * stream-decrypt one note at a time and pass the decrypted content as `body`
 * without round-tripping through a per-search `Map<id, string>` buffer.
 */
export function toSearchEntity(
  id: string,
  entry: NoteIndexEntry,
  body?: string
): SearchEntity {
  return {
    id,
    title: entry.title,
    body,
    tagIds: entry.tagIds,
    folderId: entry.folderId ?? null,
    listId: null,
    createdAt: new Date(entry.createdAt),
    updatedAt: new Date(entry.updatedAt),
    dueAt: null,
    flags: {
      starred: entry.isStarred,
      pinned: entry.isPinned,
      trashed: entry.isArchived
    }
  };
}

export const noteIndex = new NoteIndex();
