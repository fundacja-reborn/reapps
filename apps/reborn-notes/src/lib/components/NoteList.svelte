<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { ArrowLeft, FilePlus, Trash2, Search } from '@lucide/svelte';
  import { exportNoteAsMarkdown } from '$lib/services/export-import.service';
  import * as NoteService from '$lib/services/note.service';
  import { toastStore } from '@reborn/ui';
  import { notesStore, activeNoteId } from '$lib/stores/notes.store';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import type { NoteListItem } from '$lib/stores/notes.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { SidebarTrigger } from '@reborn/ui/sidebar';
  import { t } from '$lib/stores/i18n.store';
  import { sessionExpired } from '$lib/stores/sync-status.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import ConfirmDialog from './shared/ConfirmDialog.svelte';
  import NoteListItemComponent from './notes/NoteListItem.svelte';
  import NoteActionSheet from './notes/NoteActionSheet.svelte';
  import NoteListSearchBar from './notes/NoteListSearchBar.svelte';
  import NoteListSortMenu from './notes/NoteListSortMenu.svelte';
  import MoveToFolderMenu from './notes/MoveToFolderMenu.svelte';

  // ── Infinite scroll ────────────────────────────────────────────
  const PAGE_SIZE = 50;
  let visibleCount = $state(PAGE_SIZE);
  let sentinelEl = $state<HTMLDivElement | null>(null);
  let observer: IntersectionObserver | undefined;

  $effect(() => {
    void $notesStore;
    visibleCount = PAGE_SIZE;
  });

  const visibleNotes = $derived($notesStore.slice(0, visibleCount));
  const hasMore = $derived(visibleCount < $notesStore.length);

  function loadMore() {
    if (visibleCount < $notesStore.length) {
      visibleCount += PAGE_SIZE;
    }
  }

  onMount(() => {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '200px' }
    );
  });

  $effect(() => {
    const el = sentinelEl;
    if (el && observer) {
      observer.observe(el);
      return () => observer?.unobserve(el);
    }
  });

  onDestroy(() => observer?.disconnect());

  let {
    activeFolderName = '',
    activeSection = 'all',
    isTrash = false,
    showSidebarTrigger = false,
    prominentHeader = false,
    autoFocusSearch = false,
    searchOnly = false,
    onback,
    oncreate
  }: {
    activeFolderName?: string;
    activeSection?: string;
    isTrash?: boolean;
    showSidebarTrigger?: boolean;
    prominentHeader?: boolean;
    autoFocusSearch?: boolean;
    searchOnly?: boolean;
    onback?: () => void;
    oncreate?: () => void | Promise<void>;
  } = $props();

  const isMobileQuery = useIsMobile();

  let searchInputEl = $state<HTMLInputElement | null>(null);

  // Reset search when Rail section changes
  $effect(() => {
    void activeSection;
    untrack(() => {
      searchInput = '';
      searchInContent = false;
      notesStore.setSearch('');
      notesStore.setSearchInContent(false);
    });
  });

  $effect(() => {
    if (autoFocusSearch && searchInputEl) {
      requestAnimationFrame(() => searchInputEl?.focus());
    }
  });

  let menuOpenId = $state<string | null>(null);
  let movingNoteId = $state<string | null>(null);
  let deleteDialogOpen = $state(false);
  let noteToDelete = $state<string | null>(null);
  let permanentDeleteDialogOpen = $state(false);
  let noteToPermanentDelete = $state<string | null>(null);
  let emptyTrashDialogOpen = $state(false);
  let searchInput = $state('');
  let searchInContent = $state(false);
  let noteActionSheetOpen = $state(false);
  let sortSheetOpen = $state(false);
  let moveSheetOpen = $state(false);

  // Sync search state with store
  $effect(() => {
    notesStore.setSearch(searchInput);
  });

  $effect(() => {
    notesStore.setSearchInContent(searchInContent);
  });

  function onWindowClick() {
    menuOpenId = null;
    movingNoteId = null;
  }

  function clearSearch() {
    searchInput = '';
    searchInContent = false;
    notesStore.setSearch('');
    notesStore.setSearchInContent(false);
  }

  async function handleCreate() {
    if (oncreate) {
      await oncreate();
      return;
    }
    const id = await notesStore.create($t('notes.untitled'));
    activeNoteId.set(id);
  }

  // ── Note action handlers ───────────────────────────────────────

  function handleMenuOpen(noteId: string) {
    menuOpenId = noteId;
    noteActionSheetOpen = true;
  }

  function handleDelete(id: string) {
    menuOpenId = null;
    noteActionSheetOpen = false;
    noteToDelete = id;
    deleteDialogOpen = true;
  }

  async function confirmDelete() {
    if (noteToDelete) await notesStore.remove(noteToDelete);
    noteToDelete = null;
  }

  function openMoveMenu(id: string) {
    menuOpenId = null;
    noteActionSheetOpen = false;
    if (isMobileQuery.value) {
      movingNoteId = id;
      moveSheetOpen = true;
    } else {
      movingNoteId = movingNoteId === id ? null : id;
    }
  }

  async function handleMove(noteId: string, folderId: string | null, e?: Event) {
    e?.stopPropagation();
    movingNoteId = null;
    moveSheetOpen = false;
    await notesStore.move(noteId, folderId);
    if (noteId === $activeNoteId) noteDetailService.folderId = folderId;
  }

  async function handleTogglePin(noteId: string, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    noteActionSheetOpen = false;
    await notesStore.togglePin(noteId);
  }

  async function handleToggleStar(noteId: string, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    noteActionSheetOpen = false;
    await notesStore.toggleStar(noteId);
  }

  async function handleRestore(noteId: string, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    noteActionSheetOpen = false;
    await notesStore.restore(noteId);
  }

  async function handleExportNote(note: NoteListItem) {
    menuOpenId = null;
    noteActionSheetOpen = false;
    const fullNote = await NoteService.getNote(note.id);
    if (!fullNote) {
      toastStore.error($t('notes.export_failed'));
      return;
    }
    const tagNames = $tagsStore.filter((tg) => note.tags?.includes(tg.id)).map((tg) => tg.name);
    exportNoteAsMarkdown(fullNote, tagNames);
  }

  async function handleCopyNoteLink(note: NoteListItem) {
    menuOpenId = null;
    noteActionSheetOpen = false;
    const title = note.title || $t('notes.untitled');
    const link = `[${title}](note:${note.id})`;
    try {
      await navigator.clipboard.writeText(link);
      toastStore.success($t('notes.note_link_copied'));
    } catch {
      toastStore.error('Failed to copy');
    }
  }

  function handlePermanentDelete(noteId: string) {
    menuOpenId = null;
    noteActionSheetOpen = false;
    noteToPermanentDelete = noteId;
    permanentDeleteDialogOpen = true;
  }

  async function confirmPermanentDelete() {
    if (noteToPermanentDelete) await notesStore.permanentDelete(noteToPermanentDelete);
    noteToPermanentDelete = null;
  }

  const activeMenuNote = $derived(
    menuOpenId ? ($notesStore.find((n) => n.id === menuOpenId) ?? null) : null
  );
  const movingNote = $derived(
    movingNoteId ? ($notesStore.find((n) => n.id === movingNoteId) ?? null) : null
  );
</script>

<svelte:window onclick={onWindowClick} />

<div class="flex h-full flex-col">
  <!-- Panel header (hidden in searchOnly mode) -->
  {#if !searchOnly}
    <div
      class="flex shrink-0 items-center gap-1 {prominentHeader ? 'h-12' : 'h-10'} {onback
        ? 'px-3'
        : 'px-5'}"
    >
      {#if onback}
        <button
          type="button"
          onclick={onback}
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sidebar-foreground
         hover:bg-sidebar-accent transition-colors"
          aria-label={$t('nav.back')}
        >
          <ArrowLeft class="h-4 w-4" />
        </button>
      {/if}
      {#if showSidebarTrigger}
        <SidebarTrigger class="md:hidden -ml-1 shrink-0" />
      {/if}
      <span
        class="min-w-0 flex-1 truncate text-sm {prominentHeader ? 'font-medium' : 'font-normal'}"
        >{activeFolderName}</span
      >

      {#if !isTrash}
        <NoteListSortMenu bind:sortSheetOpen />
      {/if}

      {#if !isTrash}
        <button
          type="button"
          onclick={handleCreate}
          title={$t('nav.new_note')}
          aria-label={$t('nav.new_note')}
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <FilePlus class="h-4 w-4" />
        </button>
      {/if}

      {#if isTrash}
        <button
          type="button"
          onclick={() => {
            emptyTrashDialogOpen = true;
          }}
          disabled={$notesStore.length === 0}
          title={$t('trash.empty_trash')}
          aria-label={$t('trash.empty_trash')}
          class="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
        >
          <Trash2 class="h-3.5 w-3.5" />
          {$t('trash.empty_trash')}
        </button>
      {/if}
    </div>
  {/if}

  <!-- Search bar -->
  <NoteListSearchBar bind:searchInput bind:searchInContent bind:searchInputEl {searchOnly} />

  <!-- Notes list -->
  <div class="flex-1 overflow-y-auto px-3">
    {#if searchOnly && !searchInput}
      <div class="px-4 py-12 text-center">
        <Search class="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
        <p class="text-sm text-muted-foreground">{$t('notes.search_hint')}</p>
      </div>
    {:else if $notesStore.length === 0}
      <div class="px-4 py-8 text-center">
        {#if searchInput}
          <p class="text-sm text-muted-foreground">
            {$t('notes.no_match', { values: { query: searchInput } })}
          </p>
          <button
            type="button"
            onclick={clearSearch}
            class="mt-2 text-xs text-primary underline-offset-4 hover:underline"
          >
            {$t('notes.clear_search')}
          </button>
        {:else if isTrash}
          <p class="text-sm text-muted-foreground">{$t('trash.empty_short')}</p>
        {:else if $sessionExpired}
          <p class="text-sm text-muted-foreground">{$t('auth.session.empty_no_data')}</p>
        {:else}
          <p class="text-sm text-muted-foreground">{$t('notes.no_notes_short')}</p>
          <button
            type="button"
            onclick={handleCreate}
            class="mt-2 text-xs text-primary underline-offset-4 hover:underline"
          >
            {$t('notes.create_one')}
          </button>
        {/if}
      </div>
    {:else}
      <ul class="flex flex-col gap-2 py-1">
        {#each visibleNotes as note (note.id)}
          <NoteListItemComponent
            {note}
            {isTrash}
            bind:movingNoteId
            onmenuopen={handleMenuOpen}
            onpin={handleTogglePin}
            onstar={handleToggleStar}
            onmove={handleMove}
            onexport={handleExportNote}
            oncopylink={handleCopyNoteLink}
            ondelete={handleDelete}
            onrestore={handleRestore}
            onpermanentdelete={handlePermanentDelete}
          />
        {/each}
      </ul>
      {#if hasMore}
        <div bind:this={sentinelEl} class="h-8 w-full" aria-hidden="true"></div>
      {/if}
    {/if}
  </div>
</div>

<!-- Mobile: Note action Sheet -->
<NoteActionSheet
  bind:open={noteActionSheetOpen}
  note={activeMenuNote}
  {isTrash}
  onpin={handleTogglePin}
  onstar={handleToggleStar}
  onmove={openMoveMenu}
  onexport={handleExportNote}
  oncopylink={handleCopyNoteLink}
  ondelete={handleDelete}
  onrestore={handleRestore}
  onpermanentdelete={handlePermanentDelete}
/>

<!-- Mobile: Move to folder Sheet -->
{#if isMobileQuery.value}
  <MoveToFolderMenu
    noteId={movingNoteId}
    currentFolderId={movingNote?.folder_id ?? null}
    bind:open={moveSheetOpen}
    onmove={handleMove}
  />
{/if}

<ConfirmDialog
  bind:open={deleteDialogOpen}
  title={$t('notes.delete_title')}
  description={$t('notes.delete_desc')}
  confirmText={$t('notes.delete_note')}
  destructive
  onConfirm={confirmDelete}
/>

<ConfirmDialog
  bind:open={permanentDeleteDialogOpen}
  title={$t('notes.perm_delete_title')}
  description={$t('notes.perm_delete_desc')}
  confirmText={$t('notes.perm_delete_confirm')}
  destructive
  onConfirm={confirmPermanentDelete}
/>

<ConfirmDialog
  bind:open={emptyTrashDialogOpen}
  title={$t('trash.empty_trash')}
  description={$t('trash.confirm_empty')}
  confirmText={$t('trash.empty_trash')}
  destructive
  onConfirm={async () => {
    await notesStore.emptyTrash();
  }}
/>
