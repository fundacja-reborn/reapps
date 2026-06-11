import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { SavedSearchDecrypted } from '@reborn/types';
import * as SavedSearchService from '$lib/services/saved-search.service';

function createSavedSearchesStore() {
  const searches = writable<SavedSearchDecrypted[]>([]);
  const loading = writable(false);
  const error = writable<string | null>(null);

  async function refresh() {
    if (!browser) return;
    loading.set(true);
    error.set(null);
    try {
      const data = await SavedSearchService.getAllSavedSearches();
      searches.set(data);
    } catch (e: unknown) {
      error.set(e instanceof Error ? e.message : 'Failed to load saved searches');
    } finally {
      loading.set(false);
    }
  }

  async function create(name: string, query: string, folderId?: string): Promise<string> {
    const id = await SavedSearchService.createSavedSearch(name, query, folderId);
    await refresh();
    return id;
  }

  async function rename(id: string, name: string): Promise<void> {
    await SavedSearchService.renameSavedSearch(id, name);
    await refresh();
  }

  async function move(id: string, folderId: string | null): Promise<void> {
    await SavedSearchService.moveSavedSearchToFolder(id, folderId);
    await refresh();
  }

  async function remove(id: string): Promise<void> {
    await SavedSearchService.deleteSavedSearch(id);
    await refresh();
  }

  return {
    subscribe: searches.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },
    refresh,
    create,
    rename,
    move,
    remove
  };
}

export const savedSearchesStore = createSavedSearchesStore();
