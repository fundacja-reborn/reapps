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
    Trash2,
    RotateCcw,
    Trash
  } from '@lucide/svelte';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
  } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { dateFormat } from '$lib/stores/app-settings.store';
  import { activeNoteId, notesStore, type NoteListItem } from '$lib/stores/notes.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import { formatNoteDate } from '$lib/utils/date-format';
  import TagChip from '../TagChip.svelte';
  import MoveToFolderMenu from './MoveToFolderMenu.svelte';

  let {
    note,
    isTrash = false,
    breadcrumb = '',
    movingNoteId = $bindable<string | null>(null),
    onmenuopen,
    onpin,
    onstar,
    onmove,
    onexport,
    oncopylink,
    ondelete,
    onrestore,
    onpermanentdelete
  }: {
    note: NoteListItem;
    isTrash?: boolean;
    /** Folder path to show under the title — used for search results from subfolders. */
    breadcrumb?: string;
    movingNoteId: string | null;
    onmenuopen: (noteId: string) => void;
    onpin: (noteId: string, e?: Event) => void;
    onstar: (noteId: string, e?: Event) => void;
    onmove: (noteId: string, folderId: string | null, e?: Event) => void;
    onexport: (note: NoteListItem, e?: Event) => void;
    oncopylink: (note: NoteListItem, e?: Event) => void;
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
</script>

<li class="relative">
  <div
    role="button"
    tabindex="0"
    draggable="true"
    ondragstart={(e) => {
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/note-id', note.id);
      e.dataTransfer!.setData('text/plain', note.id);
    }}
    class="note-item-bg group flex cursor-pointer items-start gap-2 rounded-lg p-4 md:p-3 transition-colors
      {isActive ? 'bg-accent text-accent-foreground' : ''}"
    onclick={() => activeNoteId.set(note.id)}
    onkeydown={(e) => e.key === 'Enter' && activeNoteId.set(note.id)}
  >
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
        {formatNoteDate(displayDate, $dateFormat, $t)}
      </p>
    </div>

    <!-- Kebab menu button -->
    <div class="shrink-0 mt-1.5 md:-mt-1">
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
            {#if isTrash}
              <DropdownMenuItem onclick={(e) => onrestore(note.id, e)}>
                <RotateCcw class="h-3.5 w-3.5" />
                {$t('notes.restore')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive focus:text-destructive"
                onclick={(e) => onpermanentdelete(note.id, e)}
              >
                <Trash class="h-3.5 w-3.5" />
                {$t('notes.delete_permanently')}
              </DropdownMenuItem>
            {:else}
              <DropdownMenuItem onclick={(e) => onpin(note.id, e)}>
                {#if note.is_pinned}
                  <PinOff class="h-3.5 w-3.5" />
                  {$t('notes.unpin')}
                {:else}
                  <Pin class="h-3.5 w-3.5" />
                  {$t('notes.pin_to_top')}
                {/if}
              </DropdownMenuItem>
              <DropdownMenuItem onclick={(e) => onstar(note.id, e)}>
                {#if note.is_starred}
                  <StarOff class="h-3.5 w-3.5" />
                  {$t('notes.unstar')}
                {:else}
                  <Star class="h-3.5 w-3.5" />
                  {$t('notes.star')}
                {/if}
              </DropdownMenuItem>
              <DropdownMenuItem
                onclick={(e) => {
                  e?.stopPropagation();
                  movingNoteId = movingNoteId === note.id ? null : note.id;
                }}
              >
                <FolderInput class="h-3.5 w-3.5" />
                {$t('notes.move_to_folder')}
              </DropdownMenuItem>
              <DropdownMenuItem onclick={(e) => onexport(note, e)}>
                <Download class="h-3.5 w-3.5" />
                {$t('notes.export_markdown')}
              </DropdownMenuItem>
              <DropdownMenuItem onclick={(e) => oncopylink(note, e)}>
                <Link2 class="h-3.5 w-3.5" />
                {$t('notes.copy_note_link')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive focus:text-destructive"
                onclick={(e) => ondelete(note.id, e)}
              >
                <Trash2 class="h-3.5 w-3.5" />
                {$t('notes.delete_note')}
              </DropdownMenuItem>
            {/if}
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
</li>
