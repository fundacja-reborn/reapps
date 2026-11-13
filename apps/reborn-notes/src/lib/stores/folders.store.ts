import { derived, writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { FolderWithChildren } from '@reborn/types';
import * as FolderService from '$lib/services/folder.service';
import type {
  DeleteFolderMode,
  DeleteFolderProgressCallback,
  FolderDeleteSummary
} from '$lib/services/folder.service';
import { noteIndex } from '$lib/services/note-index.svelte';
import {
  buildArchivedFolderScope,
  listArchiveRoots,
  pruneArchivedFolders
} from '$lib/utils/archive-scope';

/**
 * The store value is the EVERYDAY tree: archived folders and everything below
 * them are left out, so the sidebar, the pickers, breadcrumbs and "new note
 * in folder" never offer an archived folder. The full tree (archive included)
 * is on `.all`, for the Archive view and for looking up the path of an
 * archived note; `.archiveRoots` lists the archived folders that view shows.
 *
 * Every refresh also hands the archived-folder scope to the note index, which
 * decides from it which notes are in the archive (a note inside an archived
 * folder carries no marker of its own).
 */
function createFoldersStore() {
  const tree = writable<FolderWithChildren[]>([]);
  const all = writable<FolderWithChildren[]>([]);
  const archiveRoots = derived(all, ($all) => listArchiveRoots($all));
  const loading = writable(false);
  const error = writable<string | null>(null);

  async function refresh() {
    if (!browser) return;
    loading.set(true);
    error.set(null);
    try {
      const data = await FolderService.getFolderTree();
      // Scope first: a list that re-reads the index on the store tick below
      // must already see which folders are archived.
      noteIndex.setArchivedFolders(buildArchivedFolderScope(data));
      all.set(data);
      tree.set(pruneArchivedFolders(data));
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

  async function setAppearance(
    id: string,
    patch: { color?: string | undefined; icon?: string | undefined }
  ): Promise<void> {
    await FolderService.setFolderAppearance(id, patch);
    await refresh();
  }

  /** Archive a folder with everything in it (one marker on the folder). */
  async function archive(id: string): Promise<void> {
    await FolderService.setFolderArchived(id, true);
    await refresh();
  }

  /** Take a folder out of the archive; it reappears where it was. */
  async function unarchive(id: string): Promise<void> {
    await FolderService.setFolderArchived(id, false);
    await refresh();
  }

  return {
    subscribe: tree.subscribe,
    /** Full tree, archived folders included (they carry `archived_at`). */
    all: { subscribe: all.subscribe },
    /** Topmost archived folders, for the Archive view. */
    archiveRoots: { subscribe: archiveRoots.subscribe },
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },
    refresh,
    create,
    rename,
    remove,
    getDeleteSummary,
    move,
    reorder,
    setAppearance,
    archive,
    unarchive
  };
}

export const foldersStore = createFoldersStore();
