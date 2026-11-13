<script lang="ts">
  /**
   * Bar under the editor header of a note that is in the archive. The note
   * stays fully editable; the bar says why it is hidden from the everyday
   * lists and offers the way back:
   *   - archived on its own -> Restore;
   *   - inside an archived folder -> Restore folder, or move the note out.
   */
  import { Archive, FolderInput, RotateCcw } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import type { NoteArchiveInfo } from '$lib/services/note-index.svelte';

  let {
    archive,
    folderName = '',
    onrestore,
    onrestorefolder,
    onmove
  }: {
    archive: NoteArchiveInfo;
    /** Name of the archived folder holding the note (when `archive.folderId`). */
    folderName?: string;
    onrestore: () => void;
    onrestorefolder: (folderId: string) => void;
    onmove: () => void;
  } = $props();

  const buttonClass =
    'flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground';
</script>

<div
  class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground"
  role="status"
>
  <span class="flex min-w-0 flex-1 items-center gap-2">
    <Archive class="h-3.5 w-3.5 shrink-0" />
    <span class="min-w-0">
      {#if archive.folderId}
        {$t('archive.banner_folder', { values: { folder: folderName } })}
      {:else}
        {$t('archive.banner_note')}
      {/if}
    </span>
  </span>
  {#if archive.folderId}
    {@const folderId = archive.folderId}
    <button type="button" class={buttonClass} onclick={onmove}>
      <FolderInput class="h-3.5 w-3.5" />
      {$t('notes.move_to_folder')}
    </button>
    <button type="button" class={buttonClass} onclick={() => onrestorefolder(folderId)}>
      <RotateCcw class="h-3.5 w-3.5" />
      {$t('archive.restore_folder')}
    </button>
  {:else}
    <button type="button" class={buttonClass} onclick={onrestore}>
      <RotateCcw class="h-3.5 w-3.5" />
      {$t('archive.restore_short')}
    </button>
  {/if}
</div>
