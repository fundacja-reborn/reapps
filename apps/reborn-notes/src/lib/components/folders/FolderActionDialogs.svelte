<script lang="ts">
  import { toastStore } from '@reborn/ui';
  import type { FolderWithChildren } from '@reborn/types';
  import { foldersStore } from '$lib/stores/folders.store';
  import { notesStore } from '$lib/stores/notes.store';
  import { t } from '$lib/stores/i18n.store';
  import { runFolderSync } from '$lib/services/folder-sync.service';
  import { archiveFolder } from '$lib/services/archive-actions';
  import type {
    DeleteFolderMode,
    DeleteFolderProgressCallback
  } from '$lib/services/folder.service';
  import DeleteFolderDialog from '$lib/components/sidebar/DeleteFolderDialog.svelte';
  import ImportMarkdownToFolderDialog from '$lib/components/import/ImportMarkdownToFolderDialog.svelte';
  import MoveToFolderMenu from '$lib/components/notes/MoveToFolderMenu.svelte';
  import FolderAppearanceDialog from './FolderAppearanceDialog.svelte';

  /**
   * Everything a folder menu needs beyond the menu itself: the color and icon
   * dialog, the "Move to…" picker, the delete dialog, the two import pickers
   * with their dialog, plus the actions with no UI of their own (archive, sync
   * now). One instance serves any number of folders - each exported function
   * takes the folder it acts on - so a list of rows mounts it once.
   *
   * The menus themselves come from `buildFolderActions`; what stays with the
   * surface is what only it can do: renaming in place, creating a note or a
   * subfolder, reordering siblings.
   */
  let {
    onAfterRemove,
    onAfterMove
  }: {
    /** The folder left the everyday tree: delete confirmed or archive done. */
    onAfterRemove?: (folder: FolderWithChildren) => void;
    /** The folder was moved; `targetId` null = top level. */
    onAfterMove?: (folder: FolderWithChildren, targetId: string | null) => void;
  } = $props();

  // Each dialog keeps its folder after closing: the content stays put through
  // the closing animation, and the next request replaces it.

  // ── Color and icon ──────────────────────────────────────────────
  let appearanceOpen = $state(false);
  let appearanceFolder = $state<FolderWithChildren | null>(null);

  export function openAppearance(folder: FolderWithChildren): void {
    appearanceFolder = folder;
    appearanceOpen = true;
  }

  // ── Move ("Move to…" picker) ────────────────────────────────────
  let moveOpen = $state(false);
  let moveFolder = $state<FolderWithChildren | null>(null);

  export function requestMove(folder: FolderWithChildren): void {
    moveFolder = folder;
    moveOpen = true;
  }

  async function handleMoveTo(targetId: string | null) {
    const folder = moveFolder;
    if (!folder) return;
    try {
      await foldersStore.move(folder.id, targetId);
    } catch {
      // Folder or its target deleted remotely mid-pick - tell the user and
      // refresh so the stale row disappears (audit 013 O56).
      toastStore.error($t('folders.move_failed_missing'));
      foldersStore.refresh();
      return;
    }
    onAfterMove?.(folder, targetId);
  }

  // ── Delete ──────────────────────────────────────────────────────
  let deleteOpen = $state(false);
  let deleteFolder = $state<FolderWithChildren | null>(null);

  export function requestDelete(folder: FolderWithChildren): void {
    deleteFolder = folder;
    deleteOpen = true;
  }

  async function confirmDelete(mode: DeleteFolderMode, onProgress: DeleteFolderProgressCallback) {
    const folder = deleteFolder;
    if (!folder) return;
    await foldersStore.remove(folder.id, mode, onProgress);
    // Cascade soft-deletes notes - refresh the visible note list so they
    // disappear from the current folder/All-notes view immediately.
    if (mode === 'cascade') notesStore.refresh();
    onAfterRemove?.(folder);
  }

  // ── Archive ─────────────────────────────────────────────────────
  // No confirmation: nothing is deleted and the toast carries an Undo.
  export async function archive(folder: FolderWithChildren): Promise<void> {
    if (await archiveFolder(folder)) onAfterRemove?.(folder);
  }

  // ── Sync now ────────────────────────────────────────────────────
  let syncing = false;

  export async function syncNow(configId: string): Promise<void> {
    if (syncing) return;
    syncing = true;
    try {
      await runFolderSync('manual', configId);
      toastStore.success($t('folders.sync_done'));
    } finally {
      syncing = false;
    }
  }

  // ── Import .md files / a folder tree into the folder ────────────
  let importOpen = $state(false);
  let importMode = $state<'files' | 'folder'>('files');
  let importTarget = $state<FolderWithChildren | null>(null);
  let importPendingFiles = $state<File[] | null>(null);
  let importFileInputEl = $state<HTMLInputElement | null>(null);
  let importFolderInputEl = $state<HTMLInputElement | null>(null);

  function pickImport(folder: FolderWithChildren, mode: 'files' | 'folder') {
    importMode = mode;
    importTarget = folder;
    const input = mode === 'files' ? importFileInputEl : importFolderInputEl;
    // Reset value so re-selecting the same files re-fires `change`.
    if (input) input.value = '';
    input?.click();
  }

  export function importFiles(folder: FolderWithChildren): void {
    pickImport(folder, 'files');
  }

  export function importFolder(folder: FolderWithChildren): void {
    pickImport(folder, 'folder');
  }

  // Shared by both hidden inputs - `importMode` was set by the trigger.
  function handleImportFilesSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0 || !importTarget) return;
    importPendingFiles = files;
    importOpen = true;
  }

  $effect(() => {
    // The dialog owns the files only while open.
    if (!importOpen) importPendingFiles = null;
  });
</script>

<FolderAppearanceDialog bind:open={appearanceOpen} folder={appearanceFolder} />

<DeleteFolderDialog
  bind:open={deleteOpen}
  folderId={deleteFolder?.id ?? null}
  folderName={deleteFolder
    ? deleteFolder.decrypt_failed
      ? $t('folders.undecryptable')
      : deleteFolder.name
    : ''}
  onConfirm={confirmDelete}
/>

<!-- "Move to…" picker - never anchored (`forceSheet`): a row inside a scroll
     container, or a menu that has just closed, is no anchor for the desktop
     popup (precedent: saved-search park + bulk move). -->
<MoveToFolderMenu
  selection={moveFolder
    ? { kind: 'single', id: moveFolder.id, currentFolderId: moveFolder.parent_id ?? null }
    : null}
  bind:open={moveOpen}
  forceSheet
  mode="move-folder"
  onmove={(folderId) => handleMoveTo(folderId)}
/>

<!-- Hidden file inputs for "Import .md here" / "Import folder here" - triggered from the menu -->
<input
  bind:this={importFileInputEl}
  type="file"
  accept=".md,text/markdown"
  multiple
  class="hidden"
  onchange={handleImportFilesSelected}
/>
<input
  bind:this={importFolderInputEl}
  type="file"
  webkitdirectory
  multiple
  class="hidden"
  onchange={handleImportFilesSelected}
/>

<ImportMarkdownToFolderDialog
  bind:open={importOpen}
  files={importPendingFiles}
  folderId={importTarget?.id ?? null}
  folderName={importTarget?.name ?? ''}
  mode={importMode}
/>
