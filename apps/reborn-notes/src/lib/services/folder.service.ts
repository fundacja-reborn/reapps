/**
 * Folder service for Reborn Notes.
 *
 * Wraps @reborn/storage folder operations with E2E encryption via CryptoManager.
 * Folder names are always encrypted with the user's master key - E2E must be unlocked before use.
 */
import {
  folderOperations,
  folderQueries,
  folderStore,
  noteOperations,
  noteQueries,
  noteStore,
  savedSearchStore
} from '@reborn/storage';
import type { FolderEncrypted } from '@reborn/types';
import type { FolderWithChildren } from '@reborn/types';
import { cryptoManager } from '@reborn/crypto';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth.store';
import {
  pushFolder,
  pushFolderUpdate,
  pushFolderDelete,
  pushNoteUpdate,
  pushNoteDelete,
  pushSavedSearchUpdate
} from './notes-sync.service';
import { noteIndex } from '$lib/services/note-index.svelte';
import { getSetting } from '$lib/utils/app-settings';
import { sortFoldersByCustomOrder, sortFoldersByName } from '$lib/utils/folder-helpers';
import { createUndecryptableRowCache, decodeTextField } from './undecryptable-rows';

// ── User identity ─────────────────────────────────────────────────

function getUserId(): string {
  const state = get(authStore);
  return state.userId!;
}

// ── Codec ─────────────────────────────────────────────────────────

async function encodeName(name: string): Promise<string> {
  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] encodeName called without master key loaded');
  }
  return cryptoManager.encryptText(name);
}

// Session cache of rows that already failed to decrypt - see
// undecryptable-rows.ts for the shared pattern (guideline 63, #15).
const undecryptableRows = createUndecryptableRowCache();

// The name is the folder's ONLY ciphertext: structure (parent_id), ordering and
// contents stay fully usable on an undecryptable row, and a rename re-encrypts
// the name under the current key (= repairs the row). The UI therefore keeps
// selection/expansion active and offers rename + delete.
function toUndecryptable(enc: FolderEncrypted): Omit<FolderWithChildren, 'children'> {
  return {
    id: enc.id,
    parent_id: enc.parent_id,
    name: '',
    order_index: enc.order_index,
    is_archived: enc.is_archived,
    created_at: enc.created_at,
    updated_at: enc.updated_at,
    decrypt_failed: true
  };
}

async function toDecrypted(enc: FolderEncrypted): Promise<Omit<FolderWithChildren, 'children'>> {
  if (undecryptableRows.has(enc.id, enc.updated_at)) return toUndecryptable(enc);
  const name = await decodeTextField(enc.name_encrypted, 'folder name');
  if (name === null) {
    undecryptableRows.mark(enc.id, enc.updated_at);
    return toUndecryptable(enc);
  }
  undecryptableRows.clear(enc.id);
  return {
    id: enc.id,
    parent_id: enc.parent_id,
    name,
    order_index: enc.order_index,
    is_archived: enc.is_archived,
    created_at: enc.created_at,
    updated_at: enc.updated_at
  };
}

// ── Public API ───────────────────────────────────────────────────

// Sibling sort is applied here, after decryption - the storage layer can only
// order by `order_index` (ciphertext-friendly). Which comparator runs depends
// on the user's folderSortMode setting: 'alphabetical' (default) sorts by
// decrypted name; 'custom' renders the user-arranged order_index with a name
// tiebreak (see sortFoldersByCustomOrder in folder-helpers).
export async function getFolderTree(): Promise<FolderWithChildren[]> {
  const all = await folderQueries.getFolderTree();
  const mode = (await getSetting('folderSortMode')) ?? 'alphabetical';
  const sortSiblings = mode === 'custom' ? sortFoldersByCustomOrder : sortFoldersByName;

  async function convertNode(
    node: FolderEncrypted & { children: (typeof node)[] }
  ): Promise<FolderWithChildren> {
    const decrypted = await toDecrypted(node);
    const children = await Promise.all(node.children.map(convertNode));
    return {
      ...decrypted,
      children: sortSiblings(children)
    };
  }

  const tree = await Promise.all(all.map(convertNode as never));
  return sortSiblings(tree as FolderWithChildren[]);
}

// `options.skipSync` defers the network push to the caller - used by batch
// importers (folder/vault import) that must order folder pushes BEFORE note
// pushes to avoid the server's `folder_id` FK check returning 404.
export async function createFolder(
  name: string,
  parentId?: string,
  options?: { skipSync?: boolean }
): Promise<string> {
  const data: Omit<FolderEncrypted, 'id' | 'order_index' | 'created_at' | 'updated_at'> = {
    user_id: getUserId(),
    name_encrypted: await encodeName(name.trim()),
    is_archived: false,
    sync_version: 0,
    sync_status: 'pending',
    ...(parentId ? { parent_id: parentId } : {})
  };
  const id = await folderOperations.createFolder(data);
  const created = await folderStore.get(id);
  if (created && !options?.skipSync)
    pushFolder({
      id: created.id,
      name_encrypted: created.name_encrypted,
      parent_id: created.parent_id,
      order_index: created.order_index,
      created_at: created.created_at
    });
  return id;
}

// `options.skipSync` defers the push to the caller, like createFolder above -
// callers that mutate several folders at once (e.g. folder-sync re-homing a
// destination path) batch one ordered pushPendingItems() so a child never
// PATCHes before its freshly-created parent lands (server 404).
export async function renameFolder(
  id: string,
  name: string,
  options?: { skipSync?: boolean }
): Promise<void> {
  const existing = await folderStore.get(id);
  if (!existing) throw new Error('Folder not found');
  const name_encrypted = await encodeName(name.trim());
  await folderStore.save({
    ...existing,
    name_encrypted,
    updated_at: new Date().toISOString(),
    sync_status: 'pending'
  });
  if (!options?.skipSync) pushFolderUpdate(id, { name_encrypted });
}

export type DeleteFolderMode = 'detach' | 'cascade';

export interface FolderDeleteSummary {
  /** Number of subfolders that will be deleted (any depth, excludes the folder itself). */
  subfolderCount: number;
  /** Number of active (non-trashed) notes that live inside the folder or its descendants. */
  noteCount: number;
}

/**
 * Count what would be affected by deleting a folder, so the UI can render an
 * informed confirmation dialog (radio choice between detach and cascade).
 */
export async function getFolderDeleteSummary(id: string): Promise<FolderDeleteSummary> {
  const descendantIds = await folderOperations.getDescendantIds(id);
  const allIds = [id, ...descendantIds];
  let noteCount = 0;
  for (const fid of allIds) {
    const notes = await noteQueries.byFolder(fid);
    noteCount += notes.length;
  }
  return { subfolderCount: descendantIds.length, noteCount };
}

/** Progress of a long-running deleteFolder, reported once per processed item. */
export interface DeleteFolderProgress {
  /** 'notes' while notes are detached/trashed, 'folders' while folder records are deleted. */
  phase: 'notes' | 'folders';
  /** Items completed in the current phase. */
  current: number;
  /** Item count of the current phase (notes across the subtree, or folders incl. the root). */
  total: number;
}

export type DeleteFolderProgressCallback = (progress: DeleteFolderProgress) => void;

/**
 * Delete a folder, with control over what happens to the notes inside.
 *
 * - `detach` (default): notes (in this folder and any descendant) keep
 *   existing but get `folder_id = null`, ending up in "All Notes". Mirrors
 *   Prisma's `onDelete: SetNull`.
 * - `cascade`: notes are soft-deleted (moved to Trash) following the same
 *   path as `deleteNote`. They remain restorable from the trash for the
 *   normal retention window.
 *
 * `onProgress` reports per-item progress (notes first, then folders) so the
 * UI can render a bar during large deletions - a subtree with hundreds of
 * notes means many seconds of sequential IndexedDB work. When omitted, the
 * up-front note count sweep is skipped entirely, so programmatic callers
 * (e.g. the periodic-folder dedup) pay no extra reads.
 */
export async function deleteFolder(
  id: string,
  mode: DeleteFolderMode = 'detach',
  onProgress?: DeleteFolderProgressCallback
): Promise<void> {
  const folderIds = [id, ...(await folderOperations.getDescendantIds(id))];

  // Count notes up front so the progress bar gets a stable total. The sweep
  // re-reads what the loop below reads again, but these are cheap IndexedDB
  // reads next to the per-note write+sync work that dominates the runtime.
  let noteTotal = 0;
  if (onProgress) {
    for (const fid of folderIds) {
      noteTotal += (await noteQueries.byFolder(fid)).length;
    }
    if (noteTotal > 0) onProgress({ phase: 'notes', current: 0, total: noteTotal });
  }
  let notesDone = 0;

  for (const fid of folderIds) {
    const notes = await noteQueries.byFolder(fid);
    for (const note of notes) {
      if (mode === 'cascade') {
        // Soft-delete: same path as deleteNote() - archive locally, push DELETE.
        // Also clear folder_id (like detach): the folder is being deleted, so the
        // server SetNulls the note anyway. Without this the trashed note keeps the
        // dead FK, and the archived-note retry sweep PATCHes it with a folder the
        // server no longer has -> 404 "Folder not found" -> recovered by the note
        // unpark, but a whole bulk-cascade would log that storm needlessly.
        await noteOperations.archive(note.id);
        const archived = await noteStore.get(note.id);
        const wasSynced = note.sync_status !== 'pending';
        if (archived) {
          await noteStore.save({
            ...archived,
            folder_id: undefined,
            sync_status: wasSynced ? 'pending' : 'synced'
          });
        }
        noteIndex.patch(note.id, {
          isArchived: true,
          folderId: undefined,
          updatedAt: new Date().toISOString()
        });
        if (wasSynced) pushNoteDelete(note.id);
      } else {
        // Detach: clear folder_id locally + on the server.
        await noteOperations.moveToFolder(note.id, null);
        const current = await noteStore.get(note.id);
        if (current) await noteStore.save({ ...current, sync_status: 'pending' });
        noteIndex.patch(note.id, { folderId: undefined });
        // A pristine ephemeral note has no server row (deleting its folder is not
        // a deliberate action on the note, so it is not promoted) - skip the push
        // to avoid a 404; it stays ephemeral and is cleaned up. #349
        if (!current?.is_ephemeral) pushNoteUpdate(note.id, { folder_id: null });
      }
      notesDone += 1;
      // Clamped: a note that appeared between the count sweep and this loop
      // must not push `current` past `total` - the progress bar and the
      // "{current} of {total}" copy both assume current <= total.
      if (onProgress && noteTotal > 0) {
        onProgress({ phase: 'notes', current: Math.min(notesDone, noteTotal), total: noteTotal });
      }
    }
  }

  // Unpark saved searches from the deleted folder (and its descendants).
  // A saved search is semantically independent of where it is parked, so it
  // survives the folder and falls back to the search-panel list. Mirrors the
  // server's `onDelete: SetNull` - but done explicitly here so sync_version
  // bumps and other devices converge without the 404-unpark fallback.
  let unparkedAny = false;
  for (const fid of folderIds) {
    const parked = await savedSearchStore.query('folder_id', fid);
    for (const search of parked) {
      const { folder_id: _gone, ...rest } = search;
      await savedSearchStore.save({
        ...rest,
        updated_at: new Date().toISOString(),
        sync_status: 'pending'
      });
      pushSavedSearchUpdate(search.id, { folder_id: null });
      unparkedAny = true;
    }
  }
  if (unparkedAny) {
    // Dynamic import keeps the service free of a static service→store cycle.
    const { savedSearchesStore } = await import('$lib/stores/saved-searches.store');
    await savedSearchesStore.refresh();
  }

  // Then delete folders bottom-up (descendants first, root last).
  onProgress?.({ phase: 'folders', current: 0, total: folderIds.length });
  let foldersDone = 0;
  for (const fid of folderIds.slice(1).reverse()) {
    await folderOperations.deleteFolder(fid);
    pushFolderDelete(fid);
    foldersDone += 1;
    onProgress?.({ phase: 'folders', current: foldersDone, total: folderIds.length });
  }
  await folderOperations.deleteFolder(id);
  pushFolderDelete(id);
  onProgress?.({ phase: 'folders', current: folderIds.length, total: folderIds.length });
}

// `options.skipSync` defers the push to the caller (see renameFolder above).
export async function moveFolderToParent(
  id: string,
  newParentId: string | null,
  options?: { skipSync?: boolean }
): Promise<void> {
  await folderOperations.moveFolder(id, newParentId);
  const current = await folderStore.get(id);
  if (current) await folderStore.save({ ...current, sync_status: 'pending' });
  if (!options?.skipSync) pushFolderUpdate(id, { parent_id: newParentId });
}

export async function reorderSiblings(
  parentId: string | null,
  orderedIds: string[]
): Promise<void> {
  await folderOperations.reorderFolders(parentId, orderedIds);
  for (const folderId of orderedIds) {
    const current = await folderStore.get(folderId);
    if (current) await folderStore.save({ ...current, sync_status: 'pending' });
  }
  orderedIds.forEach((folderId, index) => {
    pushFolderUpdate(folderId, { order_index: index });
  });
}
