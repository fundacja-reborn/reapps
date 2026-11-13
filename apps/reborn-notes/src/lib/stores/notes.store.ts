import { writable, derived, get } from 'svelte/store';
import { untrack } from 'svelte';
import { browser } from '$app/environment';
import type { NoteDecrypted } from '@reborn/types';
import {
  buildLiteAst,
  evaluate,
  isEmpty as isAstEmpty,
  parseQuery,
  requiresContent,
  type QueryAST
} from '@reborn/utils';
import * as NoteService from '$lib/services/note.service';
import { bulkRun } from '$lib/utils/bulk';
import {
  noteIndex,
  toSearchEntity,
  type NoteListItem,
  type SortBy
} from '$lib/services/note-index.svelte';
import { foldersStore } from '$lib/stores/folders.store';
import { buildSearchContext } from '$lib/services/search-context';
import { getDescendantFolderIds } from '$lib/utils/folder-helpers';
import { combineAnd } from '$lib/utils/search-compose';

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

  // Smart-folder membership filter: a saved-search query ANDed into every
  // refresh, defining WHICH notes belong to the open smart folder. The
  // interactive `searchQuery` (the in-list search box) then narrows WITHIN it.
  // Empty string = no smart folder active (normal folder/all-notes view).
  const baseQuery = writable('');
  const baseSearchInContent = writable(false);

  // Filter state (mutually exclusive: folder, tag, starred, archive, or trash)
  let currentFolderId: string | null | undefined = undefined;
  let currentTagId: string | null = null;
  let currentStarred = false;
  let currentTrash = false;
  // Archive view. `currentArchiveFolderIds` narrows it to one archived folder
  // (the folder and its descendants) when the user opens it from the view's
  // folder section; undefined = the whole archive.
  let currentArchive = false;
  let currentArchiveFolderIds: string[] | undefined = undefined;

  // Version counter to discard stale async results
  let refreshVersion = 0;
  let contentSearchVersion = 0;

  /** Sort NoteListItem[] - same logic as NoteService.sortNotes but typed for NoteListItem. */
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

  // Derived visible list - _raw is already filtered (search query + AST + content) by refresh().
  // Trash and archive keep the index's own order (archive: newest archived
  // first); everything else gets pin-first re-sort by user's sortBy.
  const notes = derived([_raw, sortBy], ([$raw, $sort]) =>
    currentTrash || currentArchive ? $raw : sortItems($raw, $sort)
  );

  /**
   * When in folder view AND a non-empty search query is active, expand the scope
   * to include the folder + all its descendant subfolders. Returns the descendant
   * folder IDs, or `null` when subtree mode is not active (caller falls back to
   * `currentFolderId`). Toggling `searchInContent` alone (without a query) does
   * not expand the scope.
   */
  function getSearchSubtreeFolderIds(): string[] | null {
    if (currentTrash || currentArchive || currentStarred || currentTagId) return null;
    if (typeof currentFolderId !== 'string') return null;
    if (!get(searchQuery).trim()) return null;
    const tree = get(foldersStore);
    const ids = getDescendantFolderIds(tree, currentFolderId);
    return ids.length > 0 ? ids : null;
  }

  /** Build filter options from current store state. */
  function buildFilterOptions() {
    if (currentTrash) return { scope: 'trash' as const };
    if (currentArchive) {
      return {
        scope: 'archive' as const,
        ...(currentArchiveFolderIds ? { folderIds: currentArchiveFolderIds } : {})
      };
    }
    const base = { scope: 'active' as const };
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
   * entirely to `triggerContentSearch()` - the title-only intermediate is
   * skipped to avoid flashing wrong results, and the previous `_raw` stays
   * visible until the body-aware pass completes.
   */
  function refresh() {
    if (!browser) return;
    const myVersion = ++refreshVersion;
    error.set(null);

    try {
      const ast = combineAnd(parseQuery(get(baseQuery)), parseQuery(get(searchQuery)));
      const filterOpts = buildFilterOptions();
      const wantsContent =
        requiresContent(ast) ||
        ((get(searchInContent) || get(baseSearchInContent)) && !isAstEmpty(ast));

      if (wantsContent) {
        // Body-aware path takes over fully. Don't pre-populate `_raw` from the
        // title-only path - title-only would drop notes whose freetext only
        // appears in body (the original "Search in content" regression).
        triggerContentSearch(ast, filterOpts);
        return;
      }

      // Cancel any in-flight content search - its result would now be stale.
      contentSearchVersion++;

      const items = untrack(() => evaluateAgainstIndex(ast, filterOpts));
      if (myVersion !== refreshVersion) return;
      _raw.set(items);
    } catch {
      // Index might not be built yet (e.g. before E2E unlock) - return empty
      if (myVersion !== refreshVersion) return;
      _raw.set([]);
    }
  }

  /**
   * Synchronous AST evaluation against the in-memory NoteIndex (no body).
   *
   * Three routing cases:
   *   1. Empty AST - return the visible scope as-is.
   *   2. Single positive leaf-text - fast title-substring path through
   *      `getFiltered({ search })`. Bypasses building a SearchContext.
   *   3. Anything else - full AST evaluation via `getFilteredByAst`.
   */
  function evaluateAgainstIndex(
    ast: QueryAST,
    filterOpts: ReturnType<typeof buildFilterOptions>
  ): NoteListItem[] {
    if (isAstEmpty(ast)) {
      const { items } = noteIndex.getFiltered({
        ...filterOpts,
        pageSize: Number.MAX_SAFE_INTEGER
      });
      return items;
    }
    if (
      ast.root !== null &&
      ast.root.kind === 'leaf-text' &&
      !ast.root.negated
    ) {
      const { items } = noteIndex.getFiltered({
        ...filterOpts,
        search: ast.root.value,
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
   *   - Drop freetext from `liteAst` - we re-check it against title+body
   *     post-decryption. Keeping it would exclude notes whose freetext lives
   *     only in body (the legacy "Search in content" regression).
   *   - Drop `has:*` filters - they need decrypted body, can't pre-check.
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
      // 1. Pre-filter: lite-AST drops body-dependent leaves (leaf-text,
      //    has:*) so the candidate set isn't pruned by predicates that need
      //    the decrypted body. Polarity-aware - `-(cat) tag:work` keeps
      //    tag:work, doesn't collapse to FALSE.
      const liteAst = buildLiteAst(ast);
      const ctx = buildSearchContext();
      const candidates = isAstEmpty(liteAst)
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
          ? await NoteService.getNoteIncludingTrashed(item.id)
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

  /** A concrete scope change (folder/tag/starred/archive/trash) exits any open
   *  smart folder - the membership filter belongs to the smart folder alone. */
  function resetBaseQuery() {
    baseQuery.set('');
    baseSearchInContent.set(false);
  }

  function leaveArchive() {
    currentArchive = false;
    currentArchiveFolderIds = undefined;
  }

  function setFolder(folderId: string | null | undefined) {
    currentFolderId = folderId;
    currentTagId = null;
    currentStarred = false;
    currentTrash = false;
    leaveArchive();
    resetBaseQuery();
    refresh();
  }

  function setTag(tagId: string | null) {
    currentTagId = tagId;
    currentFolderId = undefined;
    currentStarred = false;
    currentTrash = false;
    leaveArchive();
    resetBaseQuery();
    refresh();
  }

  function setStarred(starred: boolean) {
    currentStarred = starred;
    if (starred) {
      currentTagId = null;
      currentFolderId = undefined;
      currentTrash = false;
      leaveArchive();
    }
    resetBaseQuery();
    refresh();
  }

  function setTrash(inTrash: boolean) {
    currentTrash = inTrash;
    if (inTrash) {
      currentTagId = null;
      currentFolderId = undefined;
      currentStarred = false;
      leaveArchive();
    }
    resetBaseQuery();
    refresh();
  }

  /**
   * Show the archive: notes with their own archive marker plus everything
   * inside archived folders. `folderIds` narrows the list to one archived
   * folder (pass the folder and its descendants); omit it for the whole
   * archive. Mutually exclusive with folder/tag/starred/trash, like the others.
   */
  function setArchive(folderIds?: string[]) {
    currentArchive = true;
    currentArchiveFolderIds = folderIds;
    currentTagId = null;
    currentFolderId = undefined;
    currentStarred = false;
    currentTrash = false;
    resetBaseQuery();
    refresh();
  }

  /**
   * Open a smart folder (a pinned saved search): scope becomes the whole vault
   * (like all-notes) and `query` becomes the base membership filter ANDed into
   * every refresh. The in-list search box (setSearch) then narrows WITHIN it.
   * Mutually exclusive with folder/tag/starred/trash scope, like the others.
   */
  function setSmartFolder(query: string, inContent: boolean) {
    currentFolderId = undefined;
    currentTagId = null;
    currentStarred = false;
    currentTrash = false;
    leaveArchive();
    baseQuery.set(query);
    baseSearchInContent.set(inContent);
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

  async function create(
    title: string,
    content = '',
    folderId?: string,
    options?: { ephemeral?: boolean }
  ): Promise<string> {
    const resolvedFolder =
      folderId !== undefined
        ? folderId
        : currentFolderId === undefined
          ? undefined
          : (currentFolderId ?? undefined);
    const id = await NoteService.createNote(title, content, resolvedFolder, options);
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

  /**
   * Set (`undefined`: clear) the color mark of one or more notes. Each note is
   * written on its own, so one failure (e.g. a note deleted in another tab)
   * does not stop the rest; the counts drive the partial-failure toast.
   */
  async function setColor(
    ids: string[],
    color: string | undefined
  ): Promise<{ done: number; failed: number }> {
    const result = await bulkRun(ids, async (id) => {
      await NoteService.setNoteColor(id, color);
    });
    refresh();
    return result;
  }

  /**
   * Archive a note (its own marker). The note leaves every everyday list and
   * shows up in the Archive view; an open editor stays open.
   */
  async function archive(id: string): Promise<void> {
    await NoteService.setNoteArchived(id, true);
    refresh();
  }

  /** Take a note out of the archive (removes its own marker). */
  async function unarchive(id: string): Promise<void> {
    await NoteService.setNoteArchived(id, false);
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
    return NoteService.getNoteIncludingTrashed(id);
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
    setArchive,
    setSmartFolder,
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
    setColor,
    archive,
    unarchive,
    restore,
    permanentDelete,
    emptyTrash,
    loadNote
  };
}

export const notesStore = createNotesStore();
