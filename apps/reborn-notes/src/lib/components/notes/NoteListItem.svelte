<script lang="ts">
  import {
    EllipsisVertical,
    Pin,
    PinOff,
    Star,
    StarOff,
    FolderInput,
    Folder,
    Download,
    Link2,
    Share2,
    Trash2,
    RotateCcw,
    Trash,
    AlertTriangle
  } from '@lucide/svelte';
  import { MAX_NOTE_CONTENT_BYTES } from '@reborn/types';
  import { syncErrorMap } from '$lib/stores/sync-status.store';
  import {
    Checkbox,
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
  } from '@reborn/ui';
  import type { RowAction } from '$lib/utils/row-action';
  import { t } from '$lib/stores/i18n.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { dateFormat, timeFormat } from '$lib/stores/app-settings.store';
  import { activeNoteId, notesStore, type NoteListItem } from '$lib/stores/notes.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import { formatNoteDate } from '$lib/utils/date-format';
  import { longPress } from '$lib/utils/longPress.svelte';
  import TagChip from '../TagChip.svelte';
  import MoveToFolderMenu from './MoveToFolderMenu.svelte';

  let {
    note,
    isTrash = false,
    breadcrumb = '',
    movingNoteId = $bindable<string | null>(null),
    selectionMode = false,
    isSelected = false,
    onenterselection,
    ontoggleselect,
    onmenuopen,
    onpin,
    onstar,
    onmove,
    onexport,
    oncopylink,
    onshare,
    ondelete,
    onrestore,
    onpermanentdelete
  }: {
    note: NoteListItem;
    isTrash?: boolean;
    /** Folder path to show under the title — used for search results from subfolders. */
    breadcrumb?: string;
    movingNoteId: string | null;
    /** Whether the parent NoteList is currently in multi-select mode. */
    selectionMode?: boolean;
    /** Whether this item is currently selected. */
    isSelected?: boolean;
    /** Long-press / Cmd-click on a non-selection list — enter selection mode with this item. */
    onenterselection?: () => void;
    /** Click while in selection mode — toggle this item. opts.shift = range from last anchor. */
    ontoggleselect?: (opts?: { shift?: boolean }) => void;
    onmenuopen: (noteId: string) => void;
    onpin: (noteId: string, e?: Event) => void;
    onstar: (noteId: string, e?: Event) => void;
    onmove: (noteId: string, folderId: string | null, e?: Event) => void;
    onexport: (note: NoteListItem, e?: Event) => void;
    oncopylink: (note: NoteListItem, e?: Event) => void;
    onshare?: (note: NoteListItem, e?: Event) => void;
    ondelete: (noteId: string, e?: Event) => void;
    onrestore: (noteId: string, e?: Event) => void;
    onpermanentdelete: (noteId: string, e?: Event) => void;
  } = $props();

  const isMobileQuery = useIsMobile();
  const sortByStore = notesStore.sortBy;
  const isActive = $derived($activeNoteId === note.id);
  const noteTags = $derived($tagsStore.filter((tag) => note.tags?.includes(tag.id)));
  // Display the date matching the active sort key so the visible value matches the sort.
  // For 'title' sort fall back to updated_at (most recent activity).
  const displayDate = $derived($sortByStore === 'created_at' ? note.created_at : note.updated_at);

  // Per-note hard-rejection state (sync_status: 'sync_error'). Read from the
  // reactive map so the badge appears/clears as soon as a push is rejected or a
  // later edit re-syncs the note - no need to thread sync_status through the
  // decrypted note index.
  const syncErrorCode = $derived($syncErrorMap.get(note.id));
  const syncErrorTitle = $derived.by(() => {
    switch (syncErrorCode) {
      case 'too_large':
        return $t('sync_status.errors.too_large', {
          values: { max: Math.round(MAX_NOTE_CONTENT_BYTES / 1000) }
        });
      case 'quota_exceeded':
        return $t('sync_status.errors.quota_exceeded');
      case 'invalid':
        return $t('sync_status.errors.invalid');
      case 'rejected':
        return $t('sync_status.errors.rejected');
      default:
        return '';
    }
  });

  // Single source of truth for the row's actions — fed to both the desktop kebab
  // (DropdownMenu) and the desktop right-click ContextMenu, so they can't drift.
  const noteActions: RowAction[] = $derived(
    isTrash
      ? [
          {
            key: 'restore',
            icon: RotateCcw,
            label: $t('notes.restore'),
            run: (e) => onrestore(note.id, e)
          },
          {
            key: 'permanent-delete',
            icon: Trash,
            label: $t('notes.delete_permanently'),
            run: (e) => onpermanentdelete(note.id, e),
            destructive: true,
            separatorBefore: true
          }
        ]
      : [
          {
            key: 'pin',
            icon: note.is_pinned ? PinOff : Pin,
            label: note.is_pinned ? $t('notes.unpin') : $t('notes.pin_to_top'),
            run: (e) => onpin(note.id, e)
          },
          {
            key: 'star',
            icon: note.is_starred ? StarOff : Star,
            label: note.is_starred ? $t('notes.unstar') : $t('notes.star'),
            run: (e) => onstar(note.id, e)
          },
          {
            key: 'move',
            icon: FolderInput,
            label: $t('notes.move_to_folder'),
            run: (e) => {
              e?.stopPropagation();
              movingNoteId = movingNoteId === note.id ? null : note.id;
            }
          },
          {
            key: 'export',
            icon: Download,
            label: $t('notes.export_markdown'),
            run: (e) => onexport(note, e)
          },
          {
            key: 'copy-link',
            icon: Link2,
            label: $t('notes.copy_note_link'),
            run: (e) => oncopylink(note, e)
          },
          ...(onshare
            ? [
                {
                  key: 'share',
                  icon: Share2,
                  label: $t('share.note.menu_label'),
                  run: (e?: Event) => onshare?.(note, e)
                }
              ]
            : []),
          {
            key: 'delete',
            icon: Trash2,
            label: $t('notes.delete_note'),
            run: (e) => ondelete(note.id, e),
            destructive: true,
            separatorBefore: true
          }
        ]
  );

  function handleItemClick(e: MouseEvent) {
    if (selectionMode) {
      // Click in selection mode never opens the note — toggle selection instead.
      // shift-click extends from the last anchor; cmd/ctrl-click also toggles single.
      ontoggleselect?.({ shift: e.shiftKey });
      return;
    }
    // Cmd/Ctrl-click on a non-selection list: enter selection mode with this item.
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      onenterselection?.();
      return;
    }
    activeNoteId.set(note.id);
  }

  function handleItemKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    if (selectionMode) {
      ontoggleselect?.({ shift: e.shiftKey });
    } else {
      activeNoteId.set(note.id);
    }
  }
</script>

<li class="relative">
  <!-- Desktop right-click opens the same actions as the kebab (#348). Disabled on
       mobile (long-press is reserved for multi-select) and in selection mode. -->
  <ContextMenu>
    <ContextMenuTrigger disabled={isMobileQuery.value || selectionMode}>
      {#snippet child({ props: triggerProps })}
        <div
          {...triggerProps}
          role="button"
          tabindex="0"
          draggable={selectionMode || isMobileQuery.value ? 'false' : 'true'}
          ondragstart={(e) => {
            if (selectionMode || isMobileQuery.value) {
              e.preventDefault();
              return;
            }
            e.dataTransfer!.effectAllowed = 'move';
            e.dataTransfer!.setData('text/note-id', note.id);
            e.dataTransfer!.setData('text/plain', note.id);
          }}
          use:longPress={() => onenterselection?.()}
          class="note-item-bg group flex cursor-pointer items-start gap-2 rounded-lg p-4 md:p-3 transition-colors
            {isActive && !selectionMode ? 'list-row-active text-accent-foreground' : ''}
            {selectionMode && isSelected ? 'bg-primary/10' : ''}
            {selectionMode ? 'select-none' : ''}"
          onclick={handleItemClick}
          onkeydown={handleItemKeydown}
        >
          <!-- Selection checkbox: rendered only in selection mode so the row has no
               empty gutter in normal browsing. Entry into selection mode is via the
               header toggle (all platforms), long-press (touch), or Cmd/Ctrl-click. -->
          {#if selectionMode}
            <button
              type="button"
              class="mt-0.5 -ml-0.5 flex shrink-0 items-center justify-center rounded p-0.5"
              aria-label={isSelected ? $t('notes.multiselect.exit') : $t('notes.multiselect.enter')}
              onclick={(e) => {
                e.stopPropagation();
                ontoggleselect?.({ shift: e.shiftKey });
              }}
            >
              <span class="pointer-events-none">
                <Checkbox
                  checked={isSelected}
                  aria-label={isSelected ? $t('notes.multiselect.exit') : $t('notes.multiselect.enter')}
                />
              </span>
            </button>
          {/if}

          <!-- Pin indicator -->
          {#if note.is_pinned}
            <Pin class="mt-1.5 h-3.5 w-3.5 md:mt-1 md:h-3 md:w-3 shrink-0 text-primary/70" />
          {/if}

          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-1">
              <p class="min-w-0 flex-1 line-clamp-2 text-base md:text-sm font-normal leading-snug text-foreground">
                {note.title || $t('notes.untitled')}
              </p>
              <!-- Star indicator -->
              {#if note.is_starred}
                <Star class="mt-1.5 h-3.5 w-3.5 md:mt-1 md:h-3 md:w-3 shrink-0 fill-amber-400 text-amber-400" />
              {/if}
              <!-- Sync-error indicator: server permanently rejected this note's push. -->
              {#if syncErrorCode}
                <span title={syncErrorTitle} class="mt-1.5 shrink-0 md:mt-1">
                  <AlertTriangle
                    class="h-3.5 w-3.5 md:h-3 md:w-3 text-destructive"
                    aria-label={syncErrorTitle}
                  />
                </span>
              {/if}
            </div>
            {#if breadcrumb}
              <p
                class="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] md:text-[11px] text-muted-foreground"
                title={breadcrumb}
              >
                <Folder class="h-3 w-3 shrink-0" />
                <span class="truncate" dir="rtl">{breadcrumb}</span>
              </p>
            {/if}
            {#if noteTags.length > 0}
              <div class="mt-1 flex flex-wrap gap-1">
                {#each noteTags as tag (tag.id)}
                  <TagChip {tag} size="xs" />
                {/each}
              </div>
            {/if}
            <p class="mt-0.5 text-[13px] md:text-xs text-muted-foreground line-clamp-2">
              {formatNoteDate(displayDate, $dateFormat, $timeFormat)}
            </p>
            <!-- Visible per-note rejection reason - not just the badge/hover tooltip,
                 so the user knows WHY a note won't sync (and it works on touch). -->
            {#if syncErrorCode}
              <p class="mt-0.5 text-[13px] md:text-xs font-medium text-destructive line-clamp-2">
                {syncErrorTitle}
              </p>
            {/if}
          </div>

          <!-- Kebab menu button (hidden in selection mode — bulk actions live in the selection bar) -->
          <div class="shrink-0 mt-1.5 md:-mt-1 {selectionMode ? 'invisible pointer-events-none' : ''}">
            {#if isMobileQuery.value}
              <button
                type="button"
                onclick={(e) => {
                  e.stopPropagation();
                  onmenuopen(note.id);
                }}
                class="-m-2 flex rounded p-2 text-muted-foreground opacity-40 hover:bg-accent"
                aria-label={$t('notes.note_actions')}
                tabindex="-1"
              >
                <EllipsisVertical class="h-3.5 w-3.5" />
              </button>
            {:else}
              <DropdownMenu>
                <DropdownMenuTrigger>
                  {#snippet child({ props })}
                    <button
                      {...props}
                      type="button"
                      onclick={(e) => e.stopPropagation()}
                      class="flex h-8 w-8 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity
                        group-hover:opacity-60 hover:!opacity-100 hover:bg-accent
                        {isActive ? 'opacity-40' : ''}"
                      aria-label={$t('notes.note_actions')}
                      tabindex="-1"
                    >
                      <EllipsisVertical class="h-4 w-4" />
                    </button>
                  {/snippet}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="min-w-40">
                  {#each noteActions as { key, icon: Icon, label, run, destructive, separatorBefore } (key)}
                    {#if separatorBefore}
                      <DropdownMenuSeparator />
                    {/if}
                    <DropdownMenuItem
                      class={destructive ? 'text-destructive focus:text-destructive' : ''}
                      onclick={run}
                    >
                      <Icon class="h-3.5 w-3.5" />
                      {label}
                    </DropdownMenuItem>
                  {/each}
                </DropdownMenuContent>
              </DropdownMenu>

              <!-- Move to folder submenu (desktop only) -->
              {#if !isMobileQuery.value && movingNoteId === note.id}
                <MoveToFolderMenu
                  selection={{ kind: 'single', id: note.id, currentFolderId: note.folder_id ?? null }}
                  onmove={(folderId, e) => onmove(note.id, folderId, e)}
                  onclose={() => {
                    movingNoteId = null;
                  }}
                />
              {/if}
            {/if}
          </div>
        </div>
      {/snippet}
    </ContextMenuTrigger>
    {#if !isMobileQuery.value && !selectionMode}
      <ContextMenuContent class="min-w-44">
        {#each noteActions as { key, icon: Icon, label, run, destructive, separatorBefore } (key)}
          {#if separatorBefore}
            <ContextMenuSeparator />
          {/if}
          <ContextMenuItem
            class={destructive ? 'text-destructive focus:text-destructive' : ''}
            onclick={run}
          >
            <Icon class="h-3.5 w-3.5" />
            {label}
          </ContextMenuItem>
        {/each}
      </ContextMenuContent>
    {/if}
  </ContextMenu>
</li>
