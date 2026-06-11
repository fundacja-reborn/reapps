import { writable } from 'svelte/store';

export interface SearchHandoff {
  query: string;
  /** Restores the "search in content" toggle the saved view was saved with. */
  searchInContent: boolean;
}

/**
 * One-shot handoff of a query (plus its body-search toggle) into the search bar.
 *
 * Clicking a saved search outside the search section (e.g. a node parked in
 * the folder tree) first switches `activeSection` to 'search' and only then
 * sets this store (after a `tick()`, so NoteList's section-change reset effect
 * has already cleared the previous input). NoteList consumes the value, puts
 * it in the search input and resets the store to null.
 */
export const searchHandoff = writable<SearchHandoff | null>(null);
