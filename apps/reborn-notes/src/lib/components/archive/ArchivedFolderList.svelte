<script lang="ts">
  /**
   * Folder section of the Archive view: one row per archived folder (the
   * topmost archived folder of each archived subtree), with where it lives,
   * how many notes it holds and when it was archived.
   *
   * A row opens the folder (the list below narrows to its notes), Restore puts
   * the folder back where it was with everything in it, and the trash button
   * opens the regular delete-folder dialog.
   */
  import { ChevronRight, RotateCcw, Trash2 } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { textDirection } from '@reborn/i18n';
  import { dateFormat, timeFormat } from '$lib/stores/app-settings.store';
  import { formatNoteDate } from '$lib/utils/date-format';
  import FolderGlyph from '$lib/components/folders/FolderGlyph.svelte';
  import DeleteFolderDialog from '$lib/components/sidebar/DeleteFolderDialog.svelte';
  import { foldersStore } from '$lib/stores/folders.store';
  import { notesStore } from '$lib/stores/notes.store';
  import { noteIndex } from '$lib/services/note-index.svelte';
  import { restoreFolder } from '$lib/services/archive-actions';
  import type {
    DeleteFolderMode,
    DeleteFolderProgressCallback
  } from '$lib/services/folder.service';
  import type { ArchiveRoot } from '$lib/utils/archive-scope';

  let {
    roots,
    onopen
  }: {
    roots: ArchiveRoot[];
    /** Show only this folder's notes in the list below. */
    onopen: (root: ArchiveRoot) => void;
  } = $props();

  let restoringId = $state<string | null>(null);
  let deleteDialogOpen = $state(false);
  let rootToDelete = $state<ArchiveRoot | null>(null);

  function displayName(root: ArchiveRoot): string {
    return root.folder.decrypt_failed ? $t('folders.undecryptable') : root.folder.name;
  }

  async function handleRestore(root: ArchiveRoot, e: Event) {
    e.stopPropagation();
    if (restoringId) return;
    restoringId = root.folder.id;
    try {
      await restoreFolder(root.folder.id);
    } finally {
      restoringId = null;
    }
  }

  function handleDelete(root: ArchiveRoot, e: Event) {
    e.stopPropagation();
    rootToDelete = root;
    deleteDialogOpen = true;
  }

  async function confirmDelete(mode: DeleteFolderMode, onProgress: DeleteFolderProgressCallback) {
    if (!rootToDelete) return;
    await foldersStore.remove(rootToDelete.folder.id, mode, onProgress);
    // Either mode changes the archive list: "keep notes" leaves them in the
    // archive without a folder, "move to trash" takes them out.
    notesStore.refresh();
    rootToDelete = null;
  }
</script>

{#if roots.length > 0}
  <div class="mb-3 flex flex-col gap-1">
    <h2 class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {$t('archive.folders_title')}
    </h2>
    <ul class="flex flex-col gap-1" role="list">
      {#each roots as root (root.folder.id)}
        {@const count = noteIndex.countInFolders(root.folderIds)}
        <li>
          <div
            role="button"
            tabindex="0"
            class="group flex cursor-pointer items-start gap-2 rounded-lg p-3 text-sm transition-colors hover:bg-accent/50"
            onclick={() => onopen(root)}
            onkeydown={(e) => e.key === 'Enter' && onopen(root)}
          >
            <FolderGlyph color={root.folder.color} icon={root.folder.icon} class="mt-0.5 h-4 w-4" />
            <div class="min-w-0 flex-1">
              <p
                class="truncate {root.folder.decrypt_failed ? 'italic text-muted-foreground' : ''}"
              >
                <bdi>{displayName(root)}</bdi>
              </p>
              {#if root.path.length > 0}
                <!-- Start-side ellipsis keeps the nearest parent visible (same
                     trick as the note rows' folder path). -->
                <p
                  class="flex min-w-0 text-[0.75rem] text-muted-foreground md:text-[0.6875rem]"
                  title={root.path.join(' / ')}
                >
                  <span class="truncate" dir={$textDirection === 'rtl' ? 'ltr' : 'rtl'}
                    ><bdi>{root.path.join(' / ')}</bdi></span
                  >
                </p>
              {/if}
              <p class="mt-0.5 text-[0.8125rem] text-muted-foreground md:text-xs">
                {$t('notes.notes_count', { values: { count } })}
                <span aria-hidden="true">·</span>
                {$t('archive.archived_label')}
                <bdi>{formatNoteDate(root.at, $dateFormat, $timeFormat)}</bdi>
              </p>
            </div>
            <button
              type="button"
              onclick={(e) => handleRestore(root, e)}
              disabled={restoringId !== null}
              class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <RotateCcw class="h-3.5 w-3.5" />
              {$t('archive.restore_short')}
            </button>
            <button
              type="button"
              onclick={(e) => handleDelete(root, e)}
              title={$t('folders.delete_folder')}
              aria-label={$t('folders.delete_folder')}
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
            <ChevronRight
              class="mt-2 h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground"
            />
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<DeleteFolderDialog
  bind:open={deleteDialogOpen}
  folderId={rootToDelete?.folder.id ?? null}
  folderName={rootToDelete ? displayName(rootToDelete) : ''}
  onConfirm={confirmDelete}
/>
