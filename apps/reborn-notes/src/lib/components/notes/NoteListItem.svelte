<script lang="ts">
  import {
    EllipsisVertical,
    Pin,
    PinOff,
    Star,
    StarOff,
    Palette,
    FolderInput,
    Folder,
    Download,
    Link2,
    Share2,
    Trash2,
    RotateCcw,
    Trash,
    Archive,
    ArchiveRestore,
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
  import { textDirection } from '@reborn/i18n';
  import { tagsStore } from '$lib/stores/tags.store';
  import { dateFormat, timeFormat } from '$lib/stores/app-settings.store';
  import { activeNoteId, notesStore, type NoteListItem } from '$lib/stores/notes.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import { formatNoteDate } from '$lib/utils/date-format';
  import { longPress } from '$lib/utils/longPress.svelte';
  import { APPEARANCE_SWATCH_CLASS, isAppearanceColor } from '$lib/utils/appearance-colors';
  import TagChip from '../TagChip.svelte';
  import MoveToFolderMenu from './MoveToFolderMenu.svelte';

  let {
    note,
    isTrash = false,
    isArchive = false,
    breadcrumb = '',
    movingNoteId = $bindable<string | null>(null),
    selectionMode = false,
    isSelected = false,
    onenterselection,
    ontoggleselect,
    onmenuopen,
    onpin,
    onstar,
    oncolor,
    onmove,
    onexport,
    oncopylink,
    onshare,
    ondelete,
    onrestore,
    onpermanentdelete,
    onarchive,
    onunarchive,
    inGrid = false,
    onopenmove,
    class: className = ''
  }: {
    note: NoteListItem;
    isTrash?: boolean;
    /** Row of the Archive view: shows the archive date and a visible Restore. */
    isArchive?: boolean;
    /** Folder path to show under the title - search results from subfolders, and every row of the Archive view. */
    breadcrumb?: string;
    movingNoteId: string | null;
    /** Whether the parent NoteList is currently in multi-select mode. */
    selectionMode?: boolean;
    /** Whether this item is currently selected. */
    isSelected?: boolean;
    /** Long-press / Cmd-click on a non-selection list - enter selection mode with this item. */
    onenterselection?: () => void;
    /** Click while in selection mode - toggle this item. opts.shift = range from last anchor. */
    ontoggleselect?: (opts?: { shift?: boolean }) => void;
    onmenuopen: (noteId: string) => void;
    onpin: (noteId: string, e?: Event) => void;
    onstar: (noteId: string, e?: Event) => void;
    /** Opens the note color dialog for this note. */
    oncolor?: (noteId: string) => void;
    onmove: (noteId: string, folderId: string | null, e?: Event) => void;
    onexport: (note: NoteListItem, e?: Event) => void;
    oncopylink: (note: NoteListItem, e?: Event) => void;
    onshare?: (note: NoteListItem, e?: Event) => void;
    ondelete: (noteId: string, e?: Event) => void;
    onrestore: (noteId: string, e?: Event) => void;
    onpermanentdelete: (noteId: string, e?: Event) => void;
    /** Archive this note. The item is hidden when not wired. */
    onarchive?: (noteId: string, e?: Event) => void;
    /** Take this note out of the archive (its own marker). */
    onunarchive?: (noteId: string, e?: Event) => void;
    /** A cell of the grid layout (#523): the card fills the row height. */
    inGrid?: boolean;
    /**
     * When set, "Move to folder" asks the parent to open its picker instead of
     * the popup anchored to this row. The grid passes it: the 300px popup is
     * wider than a card and would be clipped by the list's scroll box.
     */
    onopenmove?: (noteId: string) => void;
    /** Extra classes for the `<li>` (the grid starts the unpinned notes on a new row). */
    class?: string;
  } = $props();

  const isMobileQuery = useIsMobile();
  const sortByStore = notesStore.sortBy;
  const isActive = $derived($activeNoteId === note.id);
  const noteTags = $derived($tagsStore.filter((tag) => note.tags?.includes(tag.id)));
  // Display the date matching the active sort key so the visible value matches the sort.
  // For 'title' sort fall back to updated_at (most recent activity).
  const displayDate = $derived($sortByStore === 'created_at' ? note.created_at : note.updated_at);

  // Archive: a note archived on its own can be restored right here. One that an
  // archived folder holds comes back with the folder (or by moving it out), so
  // it gets no Restore of its own - removing its marker would change nothing.
  const canUnarchive = $derived(!!onunarchive && !!note.archive && !note.archive.folderId);
  const archiveAction: RowAction[] = $derived(
    canUnarchive
      ? [
          {
            key: 'unarchive',
            icon: ArchiveRestore,
            label: $t('archive.restore'),
            run: (e?: Event) => onunarchive?.(note.id, e)
          }
        ]
      : onarchive && !note.archive
        ? [
            {
              key: 'archive',
              icon: Archive,
              label: $t('archive.action'),
              run: (e?: Event) => onarchive?.(note.id, e)
            }
          ]
        : []
  );

  // Color mark: a dot before the title. A key this build does not know (set by
  // a newer version) shows no dot; the name is spoken after the title.
  const colorKey = $derived(
    !note.decrypt_failed && isAppearanceColor(note.color) ? note.color : undefined
  );
  const colorName = $derived(colorKey ? $t(`colors.${colorKey}`) : '');

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

  // Undecryptable rows (foreign key epoch / corrupted ciphertext) render an
  // explicit placeholder instead of a blank title and never open the editor -
  // its debounced save would overwrite the ciphertext with an empty body. The
  // menu shrinks to deletion (trash rows keep restore + permanent delete: both
  // operate on the row, not its plaintext). Selection mode still works, so
  // bulk delete can sweep several ghosts at once.
  const displayTitle = $derived(
    note.decrypt_failed ? $t('notes.undecryptable') : note.title || $t('notes.untitled')
  );

  // Single source of truth for the row's actions - fed to both the desktop kebab
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
      : note.decrypt_failed
        ? [
            {
              key: 'delete',
              icon: Trash2,
              label: $t('notes.delete_note'),
              run: (e) => ondelete(note.id, e),
              destructive: true
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
          ...(oncolor
            ? [
                {
                  key: 'color',
                  icon: Palette,
                  label: $t('notes.color.action'),
                  run: (e?: Event) => {
                    e?.stopPropagation();
                    oncolor?.(note.id);
                  }
                }
              ]
            : []),
          {
            key: 'move',
            icon: FolderInput,
            label: $t('notes.move_to_folder'),
            run: (e) => {
              e?.stopPropagation();
              if (onopenmove) {
                onopenmove(note.id);
                return;
              }
              movingNoteId = movingNoteId === note.id ? null : note.id;
            }
          },
          ...archiveAction,
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
      // Click in selection mode never opens the note - toggle selection instead.
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
    if (note.decrypt_failed) return; // inert - never open the editor on a ghost
    activeNoteId.set(note.id);
  }

  function handleItemKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    if (selectionMode) {
      ontoggleselect?.({ shift: e.shiftKey });
    } else if (!note.decrypt_failed) {
      activeNoteId.set(note.id);
    }
  }
</script>

<li class="relative {className}">
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
          class="note-item-bg group flex {note.decrypt_failed && !selectionMode
            ? 'cursor-default'
            : 'cursor-pointer'} items-start gap-2 rounded-lg p-4 md:p-3 transition-colors
            {inGrid ? 'h-full' : ''}
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
              class="mt-0.5 -ms-0.5 flex shrink-0 items-center justify-center rounded p-0.5"
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
              <!-- Color mark, centered on the first title line. Decorative for
                   screen readers: the color name follows the title below. -->
              {#if colorKey}
                <span
                  class="mt-1.5 me-0.5 h-2.5 w-2.5 shrink-0 rounded-full md:h-2 md:w-2
                    {APPEARANCE_SWATCH_CLASS[colorKey]}"
                  title={colorName}
                  aria-hidden="true"
                ></span>
              {/if}
              <!-- <bdi>: the title renders in its own direction but the row keeps the
                   UI alignment, like the folder, tag and date lines below it. -->
              <p
                class="min-w-0 flex-1 line-clamp-2 text-base md:text-sm font-normal leading-snug
                  {note.decrypt_failed ? 'italic text-muted-foreground' : 'text-foreground'}"
                title={note.decrypt_failed ? $t('notes.undecryptable_hint') : undefined}
              >
                <bdi>{displayTitle}</bdi>
                {#if colorKey}
                  <span class="sr-only"
                    >{$t('notes.color.dot_label', { values: { color: colorName } })}</span
                  >
                {/if}
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
                class="mt-0.5 flex min-w-0 items-center gap-1 text-[0.75rem] md:text-[0.6875rem] text-muted-foreground"
                title={breadcrumb}
              >
                <Folder class="h-3 w-3 shrink-0" />
                <!-- Start-side ellipsis keeps the deepest folder visible: the
                     wrapper runs AGAINST the UI direction so the overflow (and
                     the ellipsis) lands where the path begins; <bdi> renders the
                     path itself in its own direction, so trailing punctuation
                     ("Notes (old)") is not reordered by the flipped wrapper. -->
                <span class="truncate" dir={$textDirection === 'rtl' ? 'ltr' : 'rtl'}
                  ><bdi>{breadcrumb}</bdi></span
                >
              </p>
            {/if}
            {#if noteTags.length > 0}
              <div class="mt-1 flex flex-wrap gap-1">
                {#each noteTags as tag (tag.id)}
                  <TagChip {tag} size="xs" />
                {/each}
              </div>
            {/if}
            <p class="mt-0.5 text-[0.8125rem] md:text-xs text-muted-foreground line-clamp-2">
              {#if isArchive && note.archive}
                {$t('archive.archived_label')}
                <bdi>{formatNoteDate(note.archive.at, $dateFormat, $timeFormat)}</bdi>
              {:else}
                {formatNoteDate(displayDate, $dateFormat, $timeFormat)}
              {/if}
            </p>
            <!-- Visible per-note rejection reason - not just the badge/hover tooltip,
                 so the user knows WHY a note won't sync (and it works on touch). -->
            {#if syncErrorCode}
              <p class="mt-0.5 text-[0.8125rem] md:text-xs font-medium text-destructive line-clamp-2">
                {syncErrorTitle}
              </p>
            {/if}
          </div>

          <!-- Archive view: Restore is one visible tap away, not only in the menu. -->
          {#if isArchive && canUnarchive && !selectionMode}
            <button
              type="button"
              onclick={(e) => {
                e.stopPropagation();
                onunarchive?.(note.id, e);
              }}
              title={$t('archive.restore')}
              aria-label={$t('archive.restore')}
              class="-my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <RotateCcw class="h-4 w-4" />
            </button>
          {/if}

          <!-- Kebab menu button (hidden in selection mode - bulk actions live in the selection bar) -->
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
              {#if !isMobileQuery.value && !onopenmove && movingNoteId === note.id}
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
