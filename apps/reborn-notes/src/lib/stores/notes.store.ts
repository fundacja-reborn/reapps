import { writable, derived, get } from 'svelte/store';
import { untrack } from 'svelte';
import { browser } from '$app/environment';
import type { NoteDecrypted } from '@reborn/types';
import {
  evaluate,
  freetextIsEmpty,
  isEmpty as isAstEmpty,
  parseQuery,
  requiresContent,
  type QueryAST
} from '@reborn/utils';
import * as NoteService from '$lib/services/note.service';
import {
  noteIndex,
  toSearchEntity,
  type NoteListItem,
  type SortBy
} from '$lib/services/note-index.svelte';
import { foldersStore } from '$lib/stores/folders.store';
import { buildSearchContext } from '$lib/services/search-context';
import { getDescendantFolderIds } from '$lib/utils/folder-helpers';

export type { SortBy, NoteListItem };

/** Currently open note ID (null = no note selected). */
export const activeNoteId = writable<string | null>(null);

function createNotesStore() {
  const _raw = writable<NoteListItem[]>([]);
  const loading = writable(false);
  const error = writable<string | null>(null);
  const searchQuery = writable('');
  const sortBy = writable<SortBy>('updated_at');
  const searchInContent = writable(false);

  // Filter state (mutually exclusive: folder, tag, starred, or trash)
  let currentFolderId: string | null | undefined = undefined;
  let currentTagId: string | null = null;
  let currentStarred = false;
  let currentTrash = false;

  // Version counter to discard stale async results
  let refreshVersion = 0;
  let contentSearchVersion = 0;

  /** Sort NoteListItem[] — same logic as NoteService.sortNotes but typed for NoteListItem. */
  function sortItems(items: NoteListItem[], sort: SortBy): NoteListItem[] {
    const sorted = [...items].sort((a, b) => {
      if (sort === 'title') {
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      }
      const aTime = new Date(sort === 'created_at' ? a.created_at : a.updated_at).getTime();
      const bTime = new Date(sort === 'created_at' ? b.created_at : b.updated_at).getTime();
      return bTime - aTime;
    });
    return [...sorted.filter((n) => n.is_pinned), ...sorted.filter((n) => !n.is_pinned)];
  }

  // Derived visible list — _raw is already filtered (search query + AST + content) by refresh().
  // Trash mode keeps the natural order; everything else gets pin-first re-sort by user's sortBy.
  const notes = derived([_raw, sortBy], ([$raw, $sort]) =>
    currentTrash ? $raw : sortItems($raw, $sort)
  );

  /**
   * When in folder view AND a non-empty search query is active, expand the scope
   * to include the folder + all its descendant subfolders. Returns the descendant
   * folder IDs, or `null` when subtree mode is not active (caller falls back to
   * `currentFolderId`). Toggling `searchInContent` alone (without a query) does
   * not expand the scope.
   */
  function getSearchSubtreeFolderIds(): string[] | null {
    if (currentTrash || currentStarred || currentTagId) return null;
    if (typeof currentFolderId !== 'string') return null;
    if (!get(searchQuery).trim()) return null;
    const tree = get(foldersStore);
    const ids = getDescendantFolderIds(tree, currentFolderId);
    return ids.length > 0 ? ids : null;
  }

  /** Build filter options from current store state. */
  function buildFilterOptions() {
    if (currentTrash) return { archived: true as const };
    const base = { archived: false as const };
    if (currentStarred) return { ...base, starred: true as const };
    if (currentTagId) return { ...base, tagId: currentTagId };
    const subtreeIds = getSearchSubtreeFolderIds();
    if (subtreeIds) return { ...base, folderIds: subtreeIds };
    return { ...base, folderId: currentFolderId };
  }

  /**
   * Refresh the list from the in-memory NoteIndex.
   *
   * Single-word freetext with no operators and no excludes takes the fast
   * title-substring path via `noteIndex.getFiltered({ search })`. Anything
   * else (multi-word AND, quoted phrase, `-exclude`, or any operator) goes
   * through AST evaluation. Operators that need note content (`has:link`,
   * freetext-in-body when the user enabled "search in content") delegate
   * entirely to `triggerContentSearch()` — the title-only intermediate is
   * skipped to avoid flashing wrong results, and the previous `_raw` stays
   * visible until the body-aware pass completes.
   */
  function refresh() {
    if (!browser) return;
    const myVersion = ++refreshVersion;
    error.set(null);

    try {
      const ast = parseQuery(get(searchQuery));
      const filterOpts = buildFilterOptions();
      const wantsContent = requiresContent(ast) || (get(searchInContent) && !isAstEmpty(ast));

      if (wantsContent) {
        // Body-aware path takes over fully. Don't pre-populate `_raw` from the
        // title-only path — title-only would drop notes whose freetext only
        // appears in body (the original "Search in content" regression).
        triggerContentSearch(ast, filterOpts);
        return;
      }

      // Cancel any in-flight content search — its result would now be stale.
      contentSearchVersion++;

      const items = untrack(() => evaluateAgainstIndex(ast, filterOpts));
      if (myVersion !== refreshVersion) return;
      _raw.set(items);
    } catch {
      // Index might not be built yet (e.g. before E2E unlock) — return empty
      if (myVersion !== refreshVersion) return;
      _raw.set([]);
    }
  }

  /**
   * Synchronous AST/freetext evaluation against the in-memory NoteIndex (no body).
   *
   * Three routing cases:
   *   1. Empty AST (no filters, no freetext) — return the visible scope as-is.
   *   2. Single-word freetext, no operators — fast title-substring path through
   *      `getFiltered({ search })`. Bypasses building a SearchContext.
   *   3. Anything else (multi-word, phrase, exclude, or operators) — full AST
   *      evaluation via `getFilteredByAst`, which handles include/exclude
   *      semantics consistently.
   */
  function evaluateAgainstIndex(
    ast: QueryAST,
    filterOpts: ReturnType<typeof buildFilterOptions>
  ): NoteListItem[] {
    if (ast.filters.length === 0 && freetextIsEmpty(ast.freetext)) {
      const { items } = noteIndex.getFiltered({
        ...filterOpts,
        pageSize: Number.MAX_SAFE_INTEGER
      });
      return items;
    }
    if (
      ast.filters.length === 0 &&
      ast.freetext.exclude.length === 0 &&
      ast.freetext.include.length === 1
    ) {
      const { items } = noteIndex.getFiltered({
        ...filterOpts,
        search: ast.freetext.include[0],
        pageSize: Number.MAX_SAFE_INTEGER
      });
      return items;
    }
    const ctx = buildSearchContext();
    const { items } = noteIndex.getFilteredByAst(ast, ctx, {
      ...filterOpts,
      pageSize: Number.MAX_SAFE_INTEGER
    });
    return items;
  }

  /**
   * Body-aware search. Streams through pre-filtered candidates one body at a
   * time, evaluates the full AST per-note, and overwrites `_raw` with matches.
   *
   * Memory: peak RAM ≈ 1 decrypted note (each iteration releases its `full`
   * binding before the next `await` resolves). Matched results are stored as
   * `NoteListItem` (metadata only, no content) so the result list is bounded
   * by the index entry size, not by note body sizes.
   *
   * Pre-filter strategy:
   *   - Drop freetext from `liteAst` — we re-check it against title+body
   *     post-decryption. Keeping it would exclude notes whose freetext lives
   *     only in body (the legacy "Search in content" regression).
   *   - Drop `has:*` filters — they need decrypted body, can't pre-check.
   *   - Keep structural operators (tag/folder/list/dates/is:*) so they narrow
   *     the candidate set before we pay the decryption cost.
   *
   * Cancellation: `contentSearchVersion` ticks on every refresh; stale
   * generations exit immediately on the next iteration boundary.
   */
  async function triggerContentSearch(
    ast: QueryAST,
    filterOpts: ReturnType<typeof buildFilterOptions>
  ) {
    if (isAstEmpty(ast)) return;
    const myVersion = ++contentSearchVersion;
    loading.set(true);
    try {
      // 1. Pre-filter: structural operators only.
      const liteAst: QueryAST = {
        freetext: { include: [], exclude: [] },
        filters: ast.filters.filter((f) => f.kind !== 'has')
      };
      const ctx = buildSearchContext();
      const candidates =
        liteAst.filters.length === 0
          ? noteIndex.getFiltered({
              ...filterOpts,
              search: undefined,
              pageSize: Number.MAX_SAFE_INTEGER
            }).items
          : noteIndex.getFilteredByAst(liteAst, ctx, {
              ...filterOpts,
              pageSize: Number.MAX_SAFE_INTEGER
            }).items;

      // 2. Stream-decrypt: peak ≈ 1 body. `full` and the per-iteration entity
      //    drop out of scope on each loop turn → eligible for GC. Only metadata
      //    (NoteListItem) is retained in `matchedItems`.
      const matchedItems: NoteListItem[] = [];
      const YIELD_EVERY = 50;
      for (let i = 0; i < candidates.length; i++) {
        if (myVersion !== contentSearchVersion) return;
        const item = candidates[i];
        const full = currentTrash
          ? await NoteService.getNoteIncludingArchived(item.id)
          : await NoteService.getNote(item.id);
        const entry = noteIndex.get(item.id);
        if (
          entry &&
          full &&
          evaluate(ast, toSearchEntity(item.id, entry, full.content), ctx)
        ) {
          matchedItems.push(item);
        }

        // Yield to the event loop every N iterations: lets the GC sweep
        // released bodies and keeps the UI responsive on large vaults.
        if ((i + 1) % YIELD_EVERY === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (myVersion !== contentSearchVersion) return;
      _raw.set(matchedItems);
    } finally {
      if (myVersion === contentSearchVersion) loading.set(false);
    }
  }

  function setFolder(folderId: string | null | undefined) {
    currentFolderId = folderId;
    currentTagId = null;
    currentStarred = false;
    currentTrash = false;
    refresh();
  }

  function setTag(tagId: string | null) {
    currentTagId = tagId;
    currentFolderId = undefined;
    currentStarred = false;
    currentTrash = false;
    refresh();
  }

  function setStarred(starred: boolean) {
    currentStarred = starred;
    if (starred) {
      currentTagId = null;
      currentFolderId = undefined;
      currentTrash = false;
    }
    refresh();
  }

  function setTrash(inTrash: boolean) {
    currentTrash = inTrash;
    if (inTrash) {
      currentTagId = null;
      currentFolderId = undefined;
      currentStarred = false;
    }
    refresh();
  }

  function setSearch(query: string) {
    searchQuery.set(query);
    // refresh() handles every flavor: empty → all, freetext → fast path,
    // operators → AST path, content-required (or content toggle) → async fork.
    refresh();
  }

  function setSearchInContent(enabled: boolean) {
    searchInContent.set(enabled);
    refresh();
  }

  function setSort(sort: SortBy) {
    sortBy.set(sort);
  }

  async function create(title: string, content = '', folderId?: string): Promise<string> {
    const resolvedFolder =
      folderId !== undefined
        ? folderId
        : currentFolderId === undefined
          ? undefined
          : (currentFolderId ?? undefined);
    const id = await NoteService.createNote(title, content, resolvedFolder);
    refresh();
    return id;
  }

  async function update(id: string, title: string, content: string): Promise<void> {
    await NoteService.updateNote(id, title, content);
    refresh();
  }

  async function rename(id: string, title: string): Promise<void> {
    await NoteService.renameNote(id, title);
    refresh();
  }

  async function remove(id: string): Promise<void> {
    await NoteService.deleteNote(id);
    activeNoteId.update((current) => (current === id ? null : current));
    refresh();
  }

  async function move(id: string, folderId: string | null): Promise<void> {
    await NoteService.moveNoteToFolder(id, folderId);
    refresh();
  }

  async function togglePin(id: string): Promise<void> {
    await NoteService.togglePin(id);
    refresh();
  }

  async function toggleStar(id: string): Promise<void> {
    await NoteService.toggleStar(id);
    refresh();
  }

  /** Restore a note from trash. */
  async function restore(id: string): Promise<void> {
    await NoteService.restoreNote(id);
    activeNoteId.update((current) => (current === id ? null : current));
    refresh();
  }

  /** Permanently delete a note (only from trash). */
  async function permanentDelete(id: string): Promise<void> {
    await NoteService.permanentlyDeleteNote(id);
    activeNoteId.update((current) => (current === id ? null : current));
    refresh();
  }

  /** Permanently delete all notes in trash. */
  async function emptyTrash(): Promise<number> {
    const count = await NoteService.emptyTrash();
    activeNoteId.set(null);
    refresh();
    return count;
  }

  /** Load a full note (with content) for the editor. */
  async function loadNote(id: string): Promise<NoteDecrypted | null> {
    return NoteService.getNoteIncludingArchived(id);
  }

  return {
    subscribe: notes.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },
    searchQuery: { subscribe: searchQuery.subscribe },
    searchInContent: { subscribe: searchInContent.subscribe },
    sortBy: { subscribe: sortBy.subscribe },
    refresh,
    setFolder,
    setTag,
    setStarred,
    setTrash,
    setSearch,
    setSearchInContent,
    setSort,
    create,
    update,
    rename,
    remove,
    move,
    togglePin,
    toggleStar,
    restore,
    permanentDelete,
    emptyTrash,
    loadNote
  };
}

export const notesStore = createNotesStore();
