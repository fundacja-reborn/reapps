<script lang="ts">
  import {
    MoreHorizontal,
    Pin,
    PinOff,
    Star,
    StarOff,
    FolderInput,
    Download,
    FileText,
    Link2,
    ScanEye,
    Trash2
  } from '@lucide/svelte';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
  } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import type { NoteListItem } from '$lib/stores/notes.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import MoveToFolderMenu from '../notes/MoveToFolderMenu.svelte';

  let {
    note,
    onmenuopen,
    onpin,
    onstar,
    onmove,
    onexport,
    onexportpdf,
    oncopylink,
    onshowxray,
    ondelete
  }: {
    note: NoteListItem | null;
    /** Mobile: opens parent-provided NoteActionSheet */
    onmenuopen: () => void;
    onpin: () => void;
    onstar: () => void;
    onmove: (folderId: string | null, e?: Event) => void;
    onexport: () => void;
    onexportpdf: () => void;
    oncopylink: () => void;
    onshowxray: () => void;
    ondelete: () => void;
  } = $props();

  const isMobileQuery = useIsMobile();
  let isMoveMenuOpen = $state(false);

  function handleMoveMenuItem(e?: Event) {
    e?.stopPropagation();
    isMoveMenuOpen = !isMoveMenuOpen;
  }

  function handleFolderSelected(_noteId: string, folderId: string | null, e?: Event) {
    e?.stopPropagation();
    isMoveMenuOpen = false;
    onmove(folderId, e);
  }

  function handleWindowClick(e: MouseEvent) {
    if (!isMoveMenuOpen) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-note-detail-move]')) return;
    isMoveMenuOpen = false;
  }
</script>

<svelte:window onclick={handleWindowClick} />

{#if note}
  <div class="relative shrink-0">
    {#if isMobileQuery.value}
      <button
        type="button"
        onclick={onmenuopen}
        class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label={$t('notes.note_actions')}
      >
        <MoreHorizontal class="h-4 w-4" />
      </button>
    {:else}
      <DropdownMenu>
        <DropdownMenuTrigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label={$t('notes.note_actions')}
            >
              <MoreHorizontal class="h-4 w-4" />
            </button>
          {/snippet}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-40">
          <DropdownMenuItem onclick={onpin}>
            {#if note.is_pinned}
              <PinOff class="h-3.5 w-3.5" />
              {$t('notes.unpin')}
            {:else}
              <Pin class="h-3.5 w-3.5" />
              {$t('notes.pin_to_top')}
            {/if}
          </DropdownMenuItem>
          <DropdownMenuItem onclick={onstar}>
            {#if note.is_starred}
              <StarOff class="h-3.5 w-3.5" />
              {$t('notes.unstar')}
            {:else}
              <Star class="h-3.5 w-3.5" />
              {$t('notes.star')}
            {/if}
          </DropdownMenuItem>
          <DropdownMenuItem onclick={handleMoveMenuItem}>
            <FolderInput class="h-3.5 w-3.5" />
            {$t('notes.move_to_folder')}
          </DropdownMenuItem>
          <DropdownMenuItem onclick={onexport}>
            <Download class="h-3.5 w-3.5" />
            {$t('notes.export_markdown')}
          </DropdownMenuItem>
          <DropdownMenuItem onclick={onexportpdf}>
            <FileText class="h-3.5 w-3.5" />
            {$t('notes.export_pdf')}
          </DropdownMenuItem>
          <DropdownMenuItem onclick={oncopylink}>
            <Link2 class="h-3.5 w-3.5" />
            {$t('notes.copy_note_link')}
          </DropdownMenuItem>
          <DropdownMenuItem onclick={onshowxray}>
            <ScanEye class="h-3.5 w-3.5" />
            {$t('encryption.title')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="text-destructive focus:text-destructive"
            onclick={ondelete}
          >
            <Trash2 class="h-3.5 w-3.5" />
            {$t('notes.delete_note')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {#if isMoveMenuOpen}
        <div data-note-detail-move>
          <MoveToFolderMenu
            noteId={note.id}
            currentFolderId={note.folder_id ?? null}
            onmove={handleFolderSelected}
            onclose={() => {
              isMoveMenuOpen = false;
            }}
          />
        </div>
      {/if}
    {/if}
  </div>
{/if}
