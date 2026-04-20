import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { TagDecrypted } from '@reborn/types';
import * as TagService from '$lib/services/tag.service';

function createTagsStore() {
  const tags = writable<TagDecrypted[]>([]);
  const loading = writable(false);
  const error = writable<string | null>(null);

  async function refresh() {
    if (!browser) return;
    loading.set(true);
    error.set(null);
    try {
      const data = await TagService.getAllTags();
      tags.set(data);
    } catch (e: unknown) {
      error.set(e instanceof Error ? e.message : 'Failed to load tags');
    } finally {
      loading.set(false);
    }
  }

  async function create(name: string, color?: string): Promise<string> {
    const id = await TagService.createTag(name, color);
    await refresh();
    return id;
  }

  async function rename(id: string, name: string): Promise<void> {
    await TagService.renameTag(id, name);
    await refresh();
  }

  async function updateColor(id: string, color: string | undefined): Promise<void> {
    await TagService.updateTagColor(id, color);
    await refresh();
  }

  async function remove(id: string): Promise<void> {
    await TagService.deleteTag(id);
    await refresh();
  }

  return {
    subscribe: tags.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },
    refresh,
    create,
    rename,
    updateColor,
    remove
  };
}

export const tagsStore = createTagsStore();
