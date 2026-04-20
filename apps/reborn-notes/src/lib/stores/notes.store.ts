import { writable, derived, get } from 'svelte/store';
import { untrack } from 'svelte';
import { browser } from '$app/environment';
import type { NoteDecrypted } from '@reborn/types';
import * as NoteService from '$lib/services/note.service';
import { noteIndex, type NoteListItem, type SortBy } from '$lib/services/note-index.svelte';

export type { SortBy, NoteListItem };

/** Currently open note ID (null = no note selected). */
export const activeNoteId = writable<string | null>(null);

function createNotesStore() {
  const _raw = writable<NoteListItem[]>([]);
  /** IDs of notes whose content matches the search query (populated by async content search). */
  const _contentMatchIds = writable<Set<string> | null>(null);
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

  // Derived visible list: title-filtered + content-search-augmented + sorted
  const notes = derived(
    [_raw, searchQuery, sortBy, searchInContent, _contentMatchIds],
    ([$raw, $q, $sort, $inContent, $contentIds]) => {
      let filtered = $raw;
      if ($q.trim()) {
        const q = $q.toLowerCase();
        // Title matches (always computed — instant, no decryption)
        const titleMatches = $raw.filter((n) => n.title.toLowerCase().includes(q));
        if ($inContent && $contentIds) {
          // Union: title matches + notes matched only by content
          const titleIds = new Set(titleMatches.map((n) => n.id));
          const contentOnly = $raw.filter((n) => !titleIds.has(n.id) && $contentIds.has(n.id));
          filtered = [...titleMatches, ...contentOnly];
        } else {
          filtered = titleMatches;
        }
      }
      return currentTrash ? filtered : sortItems(filtered, $sort);
    }
  );

  /** Build filter options from current store state. */
  function buildFilterOptions() {
    if (currentTrash) return { archived: true as const };
    const base = { archived: false as const };
    if (currentStarred) return { ...base, starred: true as const };
    if (currentTagId) return { ...base, tagId: currentTagId };
    return { ...base, folderId: currentFolderId };
  }

  /**
   * Refresh the list from the in-memory NoteIndex.
   * Synchronous — no IndexedDB hit, no decryption. Cost: <1ms for 10K notes.
   */
  function refresh() {
    if (!browser) return;
    const myVersion = ++refreshVersion;
    _contentMatchIds.set(null);
    error.set(null);

    try {
      // untrack() prevents $effect callers from creating a reactive dependency
      // on noteIndex._version — refresh() is called explicitly, not reactively.
      const { items } = untrack(() =>
        noteIndex.getFiltered({
          ...buildFilterOptions(),
          pageSize: Number.MAX_SAFE_INTEGER
        })
      );
      if (myVersion !== refreshVersion) return;
      _raw.set(items);
    } catch {
      // Index might not be built yet (e.g. before E2E unlock) — return empty
      if (myVersion !== refreshVersion) return;
      _raw.set([]);
    }
  }

  /**
   * Full-decrypt search for content matching (expensive, separate from index path).
   * Populates _contentMatchIds which the derived `notes` uses to augment title results.
   */
  async function triggerContentSearch(query: string) {
    if (!query.trim()) {
      _contentMatchIds.set(null);
      return;
    }
    const myVersion = ++contentSearchVersion;
    loading.set(true);
    try {
      let data: NoteDecrypted[];
      if (currentTrash) {
        data = await NoteService.getArchivedNotes();
      } else if (currentStarred) {
        const all = await NoteService.getNotesByFolder(undefined);
        data = all.filter((n) => n.is_starred);
      } else if (currentTagId) {
        data = await NoteService.getNotesByTag(currentTagId);
      } else {
        data = await NoteService.getNotesByFolder(currentFolderId);
      }
      if (myVersion !== contentSearchVersion) return;
      const q = query.toLowerCase();
      const matchIds = new Set(
        data.filter((n) => n.content.toLowerCase().includes(q)).map((n) => n.id)
      );
      _contentMatchIds.set(matchIds);
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
    // If content search is active, trigger full-decrypt search
    if (get(searchInContent) && query.trim()) {
      triggerContentSearch(query);
    } else {
      _contentMatchIds.set(null);
    }
  }

  function setSearchInContent(enabled: boolean) {
    searchInContent.set(enabled);
    if (enabled) {
      const q = get(searchQuery);
      if (q.trim()) triggerContentSearch(q);
    } else {
      _contentMatchIds.set(null);
    }
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
