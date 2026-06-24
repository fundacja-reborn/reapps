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
    Share2,
    ScanEye,
    Trash2,
    ListPlus,
    RefreshCw,
    ListX
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
    onshare,
    onshowxray,
    ondelete,
    tocMenuMode = 'hidden',
    tocStale = false,
    onTocApply,
    onTocRemove
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
    onshare?: () => void;
    onshowxray: () => void;
    ondelete: () => void;
    /** Table-of-contents menu state: insert (has headings, no block), manage
     *  (block present), or hidden (nothing to offer). */
    tocMenuMode?: 'insert' | 'manage' | 'hidden';
    /** Marks the refresh item as out of date (headings drifted from the block). */
    tocStale?: boolean;
    /** Insert-or-refresh the managed TOC block. */
    onTocApply?: () => void;
    /** Remove the managed TOC block. */
    onTocRemove?: () => void;
  } = $props();

  const isMobileQuery = useIsMobile();
  let isMoveMenuOpen = $state(false);

  function handleMoveMenuItem(e?: Event) {
    e?.stopPropagation();
    isMoveMenuOpen = !isMoveMenuOpen;
  }

  function handleFolderSelected(folderId: string | null, e?: Event) {
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
          {#if tocMenuMode === 'insert'}
            <DropdownMenuItem onclick={onTocApply}>
              <ListPlus class="h-3.5 w-3.5" />
              {$t('toc.insert')}
            </DropdownMenuItem>
          {:else if tocMenuMode === 'manage'}
            <DropdownMenuItem onclick={onTocApply}>
              <RefreshCw class="h-3.5 w-3.5" />
              {$t('toc.refresh')}
              {#if tocStale}
                <span
                  class="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                  title={$t('toc.stale')}
                  aria-hidden="true"
                ></span>
              {/if}
            </DropdownMenuItem>
            <DropdownMenuItem onclick={onTocRemove}>
              <ListX class="h-3.5 w-3.5" />
              {$t('toc.remove')}
            </DropdownMenuItem>
          {/if}
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
          {#if onshare}
            <DropdownMenuItem onclick={onshare}>
              <Share2 class="h-3.5 w-3.5" />
              {$t('share.note.menu_label')}
            </DropdownMenuItem>
          {/if}
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
            selection={{ kind: 'single', id: note.id, currentFolderId: note.folder_id ?? null }}
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
