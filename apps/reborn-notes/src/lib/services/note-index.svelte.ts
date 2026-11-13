/**
 * NoteIndex - in-memory cache of decrypted note metadata for list views.
 *
 * Security: RAM-only, NEVER persisted to IndexedDB/localStorage/sessionStorage.
 * Cleared on lock/logout. Rebuilt after sync.
 * ~2 MB for 10K notes (vs ~50 MB full decrypt with content).
 *
 * Consumers: NoteList, NotePicker, autocomplete [[, search sidebar.
 *
 * Replaces the old NoteTitleIndex - now stores all metadata needed for list rendering:
 * title, folderId, isPinned, isStarred, isTrashed, createdAt, updatedAt, tagIds, color,
 * archivedAt.
 * Full content is NEVER stored here - loaded on demand by note-detail.service.
 *
 * Three buckets, never mixed in one list (see NoteScope):
 *   - active  - what every everyday view, search and [[link]] suggestion shows;
 *   - archive - notes with their own archive marker, plus every note inside an
 *               archived folder (the folder scope comes from the folder store via
 *               setArchivedFolders); shown only in the Archive view;
 *   - trash   - the plain `is_archived` wire flag, whatever the archive state.
 */
import { noteStore, noteTagStore, noteTagQueries } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { decryptTitleOnly } from './note.service';
import { noteLinkGraph } from './note-link-graph.svelte';
import { noteNavHistory } from './note-nav-history.svelte';
import type { NoteDecrypted } from '@reborn/types';
import {
  evaluate,
  foldSearchText,
  type QueryAST,
  type SearchContext,
  type SearchEntity
} from '@reborn/utils';
import {
  sameArchivedFolderScope,
  type ArchivedFolderInfo,
  type ArchivedFolderScope
} from '$lib/utils/archive-scope';

export interface NoteIndexEntry {
  title: string;
  folderId: string | undefined;
  isPinned: boolean;
  isStarred: boolean;
  isTrashed: boolean;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
  /** Color mark key from the encrypted metadata bundle (RAM only, like the
   *  title - never persisted in plaintext). Absent = no color. */
  color?: string;
  /** The note's OWN archive marker from the encrypted metadata bundle (RAM
   *  only). Absent does not mean "active": the note can still be in the
   *  archive through an archived folder - ask `archiveOf()`. */
  archivedAt?: string;
  /** Row's ciphertext failed to decrypt (see undecryptable-rows.ts) - the list
   *  renders an explicit placeholder and the row cannot be opened. */
  decryptFailed?: boolean;
}

/**
 * Why and since when a note is in the archive. `folderId` is set when an
 * archived folder holds the note (the topmost archived folder above it): the
 * note then comes back by restoring that folder or by moving the note out, and
 * removing the note's own marker alone would not surface it.
 */
export interface NoteArchiveInfo {
  at: string;
  folderId?: string;
}

/** Lightweight note type for list views - NoteDecrypted minus content. */
export type NoteListItem = Omit<NoteDecrypted, 'content' | 'deleted_at'> & {
  /** Present when the note is in the archive (own marker or archived folder). */
  archive?: NoteArchiveInfo;
};

/** The bucket a list shows. Default everywhere: 'active'. */
export type NoteScope = 'active' | 'archive' | 'trash';

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
  scope?: NoteScope;
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
 * (folder/tag/starred/scope) - body content is NOT handled here. Operators
 * that need decrypted content (`has:link`, freetext-in-body) are evaluated by
 * the content-search path in `notes.store.ts`, which streams one body at a
 * time through the bare `evaluate()` + `toSearchEntity()` helpers.
 */
export interface FilterByAstOptions {
  folderId?: string | null;
  folderIds?: string[];
  tagId?: string;
  starred?: boolean;
  scope?: NoteScope;
  sortBy?: SortBy;
  page?: number;
  pageSize?: number;
}

const BATCH_SIZE = 100;

class NoteIndex {
  /** Internal map - NOT reactive on purpose; we bump _version to signal changes. */
  private _map = new Map<string, NoteIndexEntry>();

  /** Svelte 5 reactive version counter - consumers that read derived data re-render. */
  private _version = $state(0);

  private _building = $state(false);

  /** Folders in the archive (archived folders + descendants), from the folder
   *  store. Not reactive on its own - setArchivedFolders bumps _version. */
  private _archivedFolders: ArchivedFolderScope = new Map<string, ArchivedFolderInfo>();

  // ── Bulk operations ────────────────────────────────────────────

  /** Build the cache from scratch (after unlock). Non-blocking - processes in batches. */
  async build(): Promise<void> {
    if (!cryptoManager.isInitialized()) return;
    // The link graph shadows the same note set; invalidate it so it rebuilds
    // lazily against the fresh data (covers unlock + post-import refresh).
    noteLinkGraph.clear();
    this._building = true;
    try {
      // Metadata-only projection: the index needs titles + shadow fields, so
      // reading `notes` without joining `noteContents` skips deserializing
      // every content blob - the dominant cold-start cost (DB v14 split).
      const allEncrypted = await noteStore.getAllMeta();
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
            isTrashed: e.isTrashed,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
            tagIds: tagMap.get(e.id) ?? [],
            ...(e.color ? { color: e.color } : {}),
            ...(e.archivedAt ? { archivedAt: e.archivedAt } : {}),
            ...(e.decryptFailed ? { decryptFailed: true } : {})
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

  /**
   * Incrementally add/update specific notes by id: point-read just those rows
   * (noteStore.getManyMeta) and decrypt them, instead of build()'s full
   * getAllMeta()+decrypt of every note. Backs the paginated pull's per-page reveal -
   * each page lands in the index without an O(n) rebuild per page (which would
   * re-deserialize the whole notes table every page = the O(n²) trap PR #353
   * removed). Tags are read from the (already-applied) note-tag relations, so
   * call this AFTER the page's tag deltas are written. An undecryptable row
   * lands flagged (decryptFailed) like in build(); the catch below only guards
   * transient errors (e.g. crypto not ready), where skipping is right - a
   * later full rebuild (refreshStoresAfterPull) reconciles it.
   */
  async upsertFromStore(ids: string[]): Promise<void> {
    if (!cryptoManager.isInitialized() || ids.length === 0) return;
    const encrypted = await noteStore.getManyMeta(ids);
    let changed = false;
    for (const enc of encrypted) {
      try {
        const e = await decryptTitleOnly(enc);
        const tagIds = await noteTagQueries.getTagsForNote(e.id);
        this._map.set(e.id, {
          title: e.title,
          folderId: e.folderId,
          isPinned: e.isPinned,
          isStarred: e.isStarred,
          isTrashed: e.isTrashed,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          tagIds,
          ...(e.color ? { color: e.color } : {}),
          ...(e.archivedAt ? { archivedAt: e.archivedAt } : {}),
          ...(e.decryptFailed ? { decryptFailed: true } : {})
        });
        changed = true;
      } catch {
        // Skip undecryptable row; the post-pull full rebuild reconciles it.
      }
    }
    if (changed) {
      this._version++;
      // Titles/folders may have changed; invalidate the lazy link graph.
      noteLinkGraph.clear();
    }
  }

  /**
   * Rebuild from IndexedDB (after sync / import). ATOMIC: delegates to build(),
   * which fills a fresh local Map and swaps it into `this._map` only at the very
   * end. It must NOT pre-clear the map: build() yields to the event loop between
   * decrypt batches (setTimeout(0)), so a pre-clear would leave the index
   * observably EMPTY for the whole rebuild. That empty window lands right after
   * a cold-login pull sets lastSyncedAt ("Synced") and clears isSyncing - the
   * one moment both look "done" - and any index read in it (e.g.
   * findExistingPeriodicNote) sees zero notes and wrongly concludes "absent",
   * duplicating the periodic note the pull just delivered. Keeping the old,
   * complete map live until the swap closes that window. Stale entries (notes
   * deleted on the server) are dropped by the swap, since build() reads the
   * current getAll(). See guideline 57.
   */
  async rebuild(): Promise<void> {
    await this.build();
  }

  /** Wipe cache (lock / logout). */
  clear(): void {
    this._map.clear();
    this._archivedFolders = new Map();
    this._version++;
    noteLinkGraph.clear();
    // Navigation trail is session-scoped: drop it on lock/logout so Back can't
    // walk into another account's notes. NOT cleared on build() (unlock leaves
    // it empty anyway; a post-import refresh should keep the trail intact).
    noteNavHistory.clear();
  }

  // ── Incremental updates ────────────────────────────────────────

  update(id: string, entry: NoteIndexEntry): void {
    this._map.set(id, entry);
    this._version++;
  }

  /** Partial update - merges with existing entry. */
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

  // ── Archive ────────────────────────────────────────────────────

  /**
   * Replace the set of folders that are in the archive. Called by the folder
   * store on every tree refresh (it owns the decrypted tree). Returns true
   * when the set actually changed, so the caller knows the lists need a
   * refresh; an unchanged set costs no re-render.
   */
  setArchivedFolders(scope: ArchivedFolderScope): boolean {
    if (sameArchivedFolderScope(this._archivedFolders, scope)) return false;
    this._archivedFolders = scope;
    this._version++;
    return true;
  }

  /** The archived folder above (or at) `folderId`, if any. Reactive. */
  archivedFolder(folderId: string | null | undefined): ArchivedFolderInfo | undefined {
    void this._version;
    return folderId ? this._archivedFolders.get(folderId) : undefined;
  }

  /** Archive state of an entry; undefined = not in the archive. */
  archiveOf(entry: NoteIndexEntry): NoteArchiveInfo | undefined {
    const viaFolder = entry.folderId ? this._archivedFolders.get(entry.folderId) : undefined;
    if (viaFolder) return { at: entry.archivedAt ?? viaFolder.at, folderId: viaFolder.rootId };
    if (entry.archivedAt) return { at: entry.archivedAt };
    return undefined;
  }

  /** Whether a note is in the archive (own marker or archived folder). Reactive. */
  isInArchive(id: string): boolean {
    void this._version;
    const entry = this._map.get(id);
    return entry !== undefined && this.archiveOf(entry) !== undefined;
  }

  /** Number of non-trashed notes in the archive that live in `folderIds`. Reactive. */
  countInFolders(folderIds: string[]): number {
    void this._version;
    const set = new Set(folderIds);
    let count = 0;
    for (const e of this._map.values()) {
      if (!e.isTrashed && e.folderId !== undefined && set.has(e.folderId)) count++;
    }
    return count;
  }

  private inScope(entry: NoteIndexEntry, scope: NoteScope): boolean {
    if (scope === 'trash') return entry.isTrashed;
    if (entry.isTrashed) return false;
    return (this.archiveOf(entry) !== undefined) === (scope === 'archive');
  }

  private toListItem(id: string, e: NoteIndexEntry): NoteListItem {
    const archive = this.archiveOf(e);
    return {
      id,
      title: e.title,
      folder_id: e.folderId,
      is_pinned: e.isPinned,
      is_starred: e.isStarred,
      is_trashed: e.isTrashed,
      created_at: e.createdAt,
      updated_at: e.updatedAt,
      tags: e.tagIds,
      ...(e.color ? { color: e.color } : {}),
      ...(e.archivedAt ? { archived_at: e.archivedAt } : {}),
      ...(archive ? { archive } : {}),
      ...(e.decryptFailed ? { decrypt_failed: true } : {})
    };
  }

  /**
   * List order. Pinned notes lead in the active bucket only (trash and archive
   * have no pin concept). The archive is ordered by when things were archived,
   * newest first; everything else by the caller's sort key.
   */
  private compare(
    a: NoteIndexEntry,
    b: NoteIndexEntry,
    scope: NoteScope,
    sortBy: SortBy
  ): number {
    if (scope === 'active') {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
    }
    if (scope === 'archive') {
      const aAt = this.archiveOf(a)?.at ?? '';
      const bAt = this.archiveOf(b)?.at ?? '';
      const byArchived = bAt.localeCompare(aAt);
      if (byArchived !== 0) return byArchived;
      return b.updatedAt.localeCompare(a.updatedAt);
    }
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }
    const aTime = sortBy === 'created_at' ? a.createdAt : a.updatedAt;
    const bTime = sortBy === 'created_at' ? b.createdAt : b.updatedAt;
    return bTime.localeCompare(aTime); // desc (newest first)
  }

  // ── Read API (backward-compatible with NoteTitleIndex) ─────────

  /** All ACTIVE titles (not trashed, not archived) sorted by updatedAt desc.
   *  Reactive via _version. Feeds [[link]] autocomplete and the note picker:
   *  archived notes are not offered as new link targets (an existing link to
   *  one still works), and undecryptable rows are excluded because a blank
   *  garbage target must not be offered. */
  getAll(): { id: string; title: string }[] {
    void this._version;
    return Array.from(this._map.entries())
      .filter(([, e]) => this.inScope(e, 'active') && !e.decryptFailed)
      .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
      .map(([id, e]) => ({ id, title: e.title }));
  }

  /** Get a single entry by id. Reactive. */
  get(id: string): NoteIndexEntry | undefined {
    void this._version;
    return this._map.get(id);
  }

  /**
   * Resolve a single entry to a NoteListItem by id. Reactive. Null when absent.
   *
   * Unlike the filtered list in notes.store (which only holds rows matching the
   * active search/folder/tag filter), this spans the WHOLE index - so a note
   * opened via a [[link]] or the Back/Forward trail, which can land outside the
   * current sidebar filter, still resolves its list metadata.
   */
  getItem(id: string): NoteListItem | null {
    void this._version;
    const e = this._map.get(id);
    if (!e) return null;
    return this.toListItem(id, e);
  }

  /** Instant substring search across ACTIVE titles (sync). Reactive. */
  search(query: string): { id: string; title: string }[] {
    void this._version;
    if (!query.trim()) return [];
    const q = foldSearchText(query);
    return Array.from(this._map.entries())
      .filter(([, e]) => this.inScope(e, 'active') && foldSearchText(e.title).includes(q))
      .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
      .map(([id, e]) => ({ id, title: e.title }));
  }

  /** Total number of entries (including trashed and archived). Reactive. */
  get count(): number {
    void this._version;
    return this._map.size;
  }

  /**
   * Snapshot of all non-trashed entries for dedup / lookup callers (the
   * markdown import pipeline, periodic notes). Returns a new array each call -
   * safe to mutate. Excludes trashed notes; importer should not collide with
   * trashed titles.
   *
   * INCLUDES archived notes, on purpose: an archived note is a live note that
   * is only hidden. If these callers did not see it, archiving old daily notes
   * would make "open today's note" create duplicates, and re-importing a file
   * would silently add a second copy next to the archived one.
   */
  entries(): { id: string; title: string; folderId: string | undefined }[] {
    void this._version;
    const out: { id: string; title: string; folderId: string | undefined }[] = [];
    for (const [id, e] of this._map) {
      if (e.isTrashed) continue;
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
   * Shared pre-filter of both list paths: bucket (active / archive / trash),
   * folder, tag, starred. Body content is never involved.
   */
  private preFilter(options: {
    folderId?: string | null;
    folderIds?: string[];
    tagId?: string;
    starred?: boolean;
    scope: NoteScope;
  }): [string, NoteIndexEntry][] {
    const { folderId, folderIds, tagId, starred, scope } = options;
    let entries = Array.from(this._map.entries());

    entries = entries.filter(([, e]) => this.inScope(e, scope));

    // folder filter - folderIds (set) takes precedence over folderId (single)
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

    if (tagId) {
      entries = entries.filter(([, e]) => e.tagIds.includes(tagId));
    }

    if (starred) {
      entries = entries.filter(([, e]) => e.isStarred);
    }

    return entries;
  }

  /** Sort, paginate and convert a filtered entry set. */
  private toResult(
    entries: [string, NoteIndexEntry][],
    scope: NoteScope,
    sortBy: SortBy,
    page: number,
    pageSize: number
  ): FilterResult {
    entries.sort((a, b) => this.compare(a[1], b[1], scope, sortBy));
    const total = entries.length;
    const start = (page - 1) * pageSize;
    const items = entries.slice(start, start + pageSize).map(([id, e]) => this.toListItem(id, e));
    return { items, total, hasMore: start + pageSize < total };
  }

  /**
   * Unified filtering + sorting + pagination over the in-memory index.
   *
   * All operations are synchronous on the Map - no IndexedDB hit, no decryption.
   * Typical cost: <1ms for 10K entries.
   */
  getFiltered(options: FilterOptions = {}): FilterResult {
    void this._version;

    const {
      folderId,
      folderIds,
      tagId,
      starred,
      scope = 'active',
      search,
      sortBy = 'updated_at',
      page = 1,
      pageSize = 50
    } = options;

    let entries = this.preFilter({ folderId, folderIds, tagId, starred, scope });

    // title search
    if (search?.trim()) {
      const q = foldSearchText(search);
      entries = entries.filter(([, e]) => foldSearchText(e.title).includes(q));
    }

    return this.toResult(entries, scope, sortBy, page, pageSize);
  }

  /**
   * AST-driven filtering over the in-memory index.
   *
   * Pre-filter (folder/tag/starred/scope) narrows the candidate set, then
   * each remaining entry is mapped to a SearchEntity (with `body = undefined`)
   * and evaluated against the AST. Operators that require content
   * (`has:link`, freetext-in-body) are NOT served here - the caller must take
   * the body-aware path in `notes.store.ts → triggerContentSearch`.
   *
   * Operator → entity mapping for notes:
   *   - `is:starred`  → `entity.flags.starred = entry.isStarred`
   *   - `is:pinned`   → `entity.flags.pinned  = entry.isPinned`
   *   - `is:completed`/`is:overdue`/`due:`     → always false (notes have no completion/due semantics)
   *   - `list:`       → always false (notes have no lists)
   *
   * The active / archive / trash split is handled by the `scope` pre-filter
   * above - there is no public `is:trashed` or `is:archived` operator, so a
   * query can never pull notes across buckets.
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
      scope = 'active',
      sortBy = 'updated_at',
      page = 1,
      pageSize = 50
    } = options;

    const entries = this.preFilter({ folderId, folderIds, tagId, starred, scope }).filter(
      ([id, e]) => evaluate(ast, toSearchEntity(id, e), ctx)
    );

    return this.toResult(entries, scope, sortBy, page, pageSize);
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
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain immutable timestamp in a returned value, not reactive state
    createdAt: new Date(entry.createdAt),
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain immutable timestamp in a returned value, not reactive state
    updatedAt: new Date(entry.updatedAt),
    dueAt: null,
    flags: {
      starred: entry.isStarred,
      pinned: entry.isPinned,
      trashed: entry.isTrashed
    }
  };
}

export const noteIndex = new NoteIndex();
