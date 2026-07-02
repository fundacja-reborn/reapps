import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { FolderWithChildren } from '@reborn/types';
import * as FolderService from '$lib/services/folder.service';
import type {
  DeleteFolderMode,
  DeleteFolderProgressCallback,
  FolderDeleteSummary
} from '$lib/services/folder.service';

function createFoldersStore() {
  const tree = writable<FolderWithChildren[]>([]);
  const loading = writable(false);
  const error = writable<string | null>(null);

  async function refresh() {
    if (!browser) return;
    loading.set(true);
    error.set(null);
    try {
      const data = await FolderService.getFolderTree();
      tree.set(data);
    } catch (e: unknown) {
      error.set(e instanceof Error ? e.message : 'Failed to load folders');
    } finally {
      loading.set(false);
    }
  }

  async function create(
    name: string,
    parentId?: string,
    options?: { skipSync?: boolean }
  ): Promise<string> {
    const id = await FolderService.createFolder(name, parentId, options);
    await refresh();
    return id;
  }

  async function rename(
    id: string,
    name: string,
    options?: { skipSync?: boolean }
  ): Promise<void> {
    await FolderService.renameFolder(id, name, options);
    await refresh();
  }

  async function remove(
    id: string,
    mode: DeleteFolderMode = 'detach',
    onProgress?: DeleteFolderProgressCallback
  ): Promise<void> {
    await FolderService.deleteFolder(id, mode, onProgress);
    await refresh();
  }

  async function getDeleteSummary(id: string): Promise<FolderDeleteSummary> {
    return FolderService.getFolderDeleteSummary(id);
  }

  async function move(
    id: string,
    newParentId: string | null,
    options?: { skipSync?: boolean }
  ): Promise<void> {
    await FolderService.moveFolderToParent(id, newParentId, options);
    await refresh();
  }

  async function reorder(parentId: string | null, orderedIds: string[]): Promise<void> {
    await FolderService.reorderSiblings(parentId, orderedIds);
    await refresh();
  }

  return {
    subscribe: tree.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },
    refresh,
    create,
    rename,
    remove,
    getDeleteSummary,
    move,
    reorder
  };
}

export const foldersStore = createFoldersStore();
