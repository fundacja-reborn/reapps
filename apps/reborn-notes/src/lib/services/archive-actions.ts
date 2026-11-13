/**
 * Archive / restore actions as the UI runs them: the store call, the list
 * refresh and the toast in one place, so the note menus, the folder menus,
 * the editor bar and the Archive view all behave the same.
 *
 * The data side lives in note.service (`setNoteArchived`) and folder.service
 * (`setFolderArchived`); nothing here touches ciphertext.
 */
import { get } from 'svelte/store';
import { toastStore } from '@reborn/ui';
import type { FolderWithChildren } from '@reborn/types';
import { t as i18nT } from '$lib/stores/i18n.store';
import { foldersStore } from '$lib/stores/folders.store';
import { notesStore } from '$lib/stores/notes.store';
import { periodicNotesSettings } from '$lib/stores/app-settings.store';
import { syncedFolderConfigs } from './folder-sync.service';
import { bulkRun } from '$lib/utils/bulk';
import { collectFolderIds, folderArchiveBlock } from '$lib/utils/archive-scope';

function tr(key: string, values?: Record<string, string | number>): string {
  return get(i18nT)(key, values ? { values } : undefined);
}

/** Archive one note, with an Undo on the toast. */
export async function archiveNote(id: string): Promise<void> {
  await notesStore.archive(id);
  toastStore.success(tr('archive.note_archived'), {
    action: { label: tr('archive.undo'), onClick: () => void notesStore.unarchive(id) }
  });
}

/** Take one note out of the archive (its own marker). */
export async function restoreNote(id: string): Promise<void> {
  await notesStore.unarchive(id);
  toastStore.success(tr('archive.note_restored'));
}

function reportPartial(total: number, done: number, failed: number): void {
  if (failed > 0) {
    toastStore.error(tr('notes.multiselect.partial_failure', { done, total, failed }));
  }
}

/** Archive several notes (multi-select). */
export async function archiveNotes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { done, failed } = await bulkRun(ids, (id) => notesStore.archive(id));
  toastStore.success(tr('archive.archived_count', { count: done }));
  reportPartial(ids.length, done, failed);
}

/** Take several notes out of the archive (multi-select in the Archive view). */
export async function restoreNotes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { done, failed } = await bulkRun(ids, (id) => notesStore.unarchive(id));
  toastStore.success(tr('archive.restored_count', { count: done }));
  reportPartial(ids.length, done, failed);
}

/**
 * Archive a folder with everything in it. Refused, with the reason shown,
 * for a folder that Periodic Notes or folder sync keeps writing into (see
 * `folderArchiveBlock`). Returns whether the folder was archived.
 */
export async function archiveFolder(folder: FolderWithChildren): Promise<boolean> {
  const periodic = get(periodicNotesSettings);
  const block = folderArchiveBlock(
    collectFolderIds(folder),
    [periodic.daily.folderId, periodic.weekly.folderId, periodic.monthly.folderId],
    get(syncedFolderConfigs).keys()
  );
  if (block) {
    // Literal keys (not a template) so the i18n tooling sees them as used.
    toastStore.info(
      tr(block === 'periodic' ? 'archive.blocked_periodic' : 'archive.blocked_sync')
    );
    return false;
  }
  await foldersStore.archive(folder.id);
  notesStore.refresh();
  toastStore.success(tr('archive.folder_archived'), {
    action: {
      label: tr('archive.undo'),
      onClick: () => void restoreFolder(folder.id, { silent: true })
    }
  });
  return true;
}

/** Take a folder out of the archive; it and its notes reappear in place. */
export async function restoreFolder(id: string, options?: { silent?: boolean }): Promise<void> {
  await foldersStore.unarchive(id);
  notesStore.refresh();
  if (!options?.silent) toastStore.success(tr('archive.folder_restored'));
}
