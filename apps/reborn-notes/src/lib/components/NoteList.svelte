<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    ArrowLeft,
    FilePlus,
    FolderPlus,
    Trash2,
    Search,
    X,
    Pin,
    PinOff,
    Star,
    StarOff,
    FolderInput,
    RotateCcw,
    Trash,
    ListChecks
  } from '@lucide/svelte';
  import { exportNoteAsMarkdown } from '$lib/services/export-import.service';
  import * as NoteService from '$lib/services/note.service';
  import { toastStore } from '@reborn/ui';
  import { notesStore, activeNoteId } from '$lib/stores/notes.store';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import type { NoteListItem } from '$lib/stores/notes.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { SidebarTrigger } from '@reborn/ui/sidebar';
  import { t } from '$lib/stores/i18n.store';
  import { sessionExpired, isInitialSync } from '$lib/stores/sync-status.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import ConfirmDialog from './shared/ConfirmDialog.svelte';
  import NoteListItemComponent from './notes/NoteListItem.svelte';
  import NoteActionSheet from './notes/NoteActionSheet.svelte';
  import ShareNoteDialog from './notes/ShareNoteDialog.svelte';
  import NoteListSearchBar from './notes/NoteListSearchBar.svelte';
  import NoteListSortMenu from './notes/NoteListSortMenu.svelte';
  import MoveToFolderMenu from './notes/MoveToFolderMenu.svelte';
  import SubfolderList from './SubfolderList.svelte';
  import FolderActionMenu from './sidebar/FolderActionMenu.svelte';
  import type { FolderWithChildren } from '@reborn/types';
  import { foldersStore } from '$lib/stores/folders.store';
  import { buildBreadcrumb } from '$lib/utils/folder-helpers';
  import { bulkRun } from '$lib/utils/bulk';

  function findFolderNode(
    nodes: FolderWithChildren[],
    id: string
  ): FolderWithChildren | null {
    for (const n of nodes) {
      if (n.id === id) return n;
      const sub = findFolderNode(n.children ?? [], id);
      if (sub) return sub;
    }
    return null;
  }

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

  // ── Share dialog state ─────────────────────────────────────────
  let shareDialogOpen = $state(false);
  let shareNoteId = $state<string | null>(null);
  let shareNoteTitle = $state<string>('');

  function handleShare(note: NoteListItem, e?: Event) {
    e?.stopPropagation();
    shareNoteId = note.id;
    shareNoteTitle = note.title ?? '';
    shareDialogOpen = true;
  }

  let {
    activeFolderName = '',
    activeSection = 'all',
    activeFolderId = null,
    isTrash = false,
    isPeriodic = false,
    showSidebarTrigger = false,
    prominentHeader = false,
    autoFocusSearch = false,
    searchOnly = false,
    subfolders = [],
    onback,
    oncreate,
    onSubfolderSelect,
    onNewSubfolder
  }: {
    activeFolderName?: string;
    activeSection?: string;
    /** Current folder ID — used to render a breadcrumb under search results from subfolders. */
    activeFolderId?: string | null;
    isTrash?: boolean;
    isPeriodic?: boolean;
    showSidebarTrigger?: boolean;
    prominentHeader?: boolean;
    autoFocusSearch?: boolean;
    searchOnly?: boolean;
    subfolders?: FolderWithChildren[];
    onback?: () => void;
    oncreate?: () => void | Promise<void>;
    onSubfolderSelect?: (id: string) => void;
    /** Only provided when we're inside a specific folder — renders the "new subfolder" icon. */
    onNewSubfolder?: () => void;
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

  // Mobile: returning from a note panel to the list should reset search.
  // The list panel stays mounted behind the note (CSS translate), so without
  // this the previous query lingers. Desktop keeps the list visible alongside
  // the note, so there is no "return" event there.
  let prevActiveNoteId: string | null = null;
  $effect(() => {
    const current = $activeNoteId;
    const prev = prevActiveNoteId;
    prevActiveNoteId = current;
    if (isMobileQuery.value && prev !== null && current === null) {
      untrack(() => {
        if (!searchInput && !searchInContent) return;
        searchInput = '';
        searchInContent = false;
        notesStore.setSearch('');
        notesStore.setSearchInContent(false);
      });
    }
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

  // ── Multi-select state ─────────────────────────────────────────
  let selectionMode = $state(false);
  let selectedIds = $state(new SvelteSet<string>());
  // Anchor for shift-click range selection (desktop). Tracks the last toggled id.
  let lastAnchorId = $state<string | null>(null);
  let bulkDeleteDialogOpen = $state(false);
  let bulkPermanentDeleteDialogOpen = $state(false);
  let bulkMoveSheetOpen = $state(false);

  function exitSelectionMode() {
    selectionMode = false;
    selectedIds.clear();
    lastAnchorId = null;
  }

  // Exit selection mode when the view changes (different folder, tag, starred, trash).
  // Tracking these reactive deps via void-references invalidates the effect when the
  // parent passes a different value.
  $effect(() => {
    void activeSection;
    void activeFolderId;
    void isTrash;
    untrack(() => {
      if (selectionMode || selectedIds.size > 0) exitSelectionMode();
    });
  });

  // Mobile: returning from a note panel to the list also exits selection.
  // Tracks the previous activeNoteId so we only fire on the transition
  // "note open → list" — not on every render where activeNoteId is null
  // (which would re-fire the moment we *enter* selection mode from the list
  // and immediately undo it).
  let prevActiveNoteIdForSelection: string | null = null;
  $effect(() => {
    const current = $activeNoteId;
    const prev = prevActiveNoteIdForSelection;
    prevActiveNoteIdForSelection = current;
    if (isMobileQuery.value && prev !== null && current === null) {
      untrack(() => {
        if (selectionMode) exitSelectionMode();
      });
    }
  });

  function enterSelectionMode(noteId: string) {
    if (!selectionMode) selectionMode = true;
    selectedIds.add(noteId);
    lastAnchorId = noteId;
  }

  function toggleSelectionMode() {
    if (selectionMode) exitSelectionMode();
    else selectionMode = true;
  }

  function toggleSelection(noteId: string, opts?: { shift?: boolean }) {
    if (opts?.shift && lastAnchorId !== null && lastAnchorId !== noteId) {
      // Range from anchor → noteId across the *currently visible* notes.
      const ids = visibleNotes.map((n) => n.id);
      const iA = ids.indexOf(lastAnchorId);
      const iB = ids.indexOf(noteId);
      if (iA !== -1 && iB !== -1) {
        const [lo, hi] = iA < iB ? [iA, iB] : [iB, iA];
        for (let i = lo; i <= hi; i++) selectedIds.add(ids[i]!);
        lastAnchorId = noteId;
        if (!selectionMode) selectionMode = true;
        return;
      }
    }
    if (selectedIds.has(noteId)) {
      selectedIds.delete(noteId);
      if (selectedIds.size === 0) {
        // Empty selection naturally exits the mode — symmetric with delete/move that
        // empties the set.
        selectionMode = false;
        lastAnchorId = null;
      }
    } else {
      selectedIds.add(noteId);
      lastAnchorId = noteId;
      if (!selectionMode) selectionMode = true;
    }
  }

  function selectAllVisible() {
    for (const n of visibleNotes) selectedIds.add(n.id);
    if (visibleNotes.length > 0) {
      if (!selectionMode) selectionMode = true;
      lastAnchorId = visibleNotes[visibleNotes.length - 1]!.id;
    }
  }

  // ── Bulk action helpers ────────────────────────────────────────
  // Selected items are derived from the *visible* notes store so we never operate on
  // stale IDs that have disappeared from the user's current view.
  const selectedItems = $derived($notesStore.filter((n) => selectedIds.has(n.id)));
  const allPinned = $derived(
    selectedItems.length > 0 && selectedItems.every((n) => n.is_pinned)
  );
  const allStarred = $derived(
    selectedItems.length > 0 && selectedItems.every((n) => n.is_starred)
  );

  function reportPartial(total: number, done: number, failed: number) {
    if (failed > 0) {
      toastStore.error(
        $t('notes.multiselect.partial_failure', { values: { done, total, failed } })
      );
    }
  }

  async function bulkPin() {
    const items = selectedItems;
    if (items.length === 0) return;
    // Heuristic: pin all unpinned if any unpinned exist; otherwise unpin all.
    const anyUnpinned = items.some((n) => !n.is_pinned);
    const targets = anyUnpinned
      ? items.filter((n) => !n.is_pinned).map((n) => n.id)
      : items.map((n) => n.id);
    const { done, failed } = await bulkRun(targets, (id) => notesStore.togglePin(id));
    toastStore.success(
      $t(
        anyUnpinned ? 'notes.multiselect.pinned_count' : 'notes.multiselect.unpinned_count',
        { values: { count: done } }
      )
    );
    reportPartial(targets.length, done, failed);
  }

  async function bulkStar() {
    const items = selectedItems;
    if (items.length === 0) return;
    const anyUnstarred = items.some((n) => !n.is_starred);
    const targets = anyUnstarred
      ? items.filter((n) => !n.is_starred).map((n) => n.id)
      : items.map((n) => n.id);
    const { done, failed } = await bulkRun(targets, (id) => notesStore.toggleStar(id));
    toastStore.success(
      $t(
        anyUnstarred ? 'notes.multiselect.starred_count' : 'notes.multiselect.unstarred_count',
        { values: { count: done } }
      )
    );
    reportPartial(targets.length, done, failed);
  }

  async function confirmBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const { done, failed } = await bulkRun(ids, (id) => notesStore.remove(id));
    toastStore.success($t('notes.multiselect.deleted_count', { values: { count: done } }));
    reportPartial(ids.length, done, failed);
    exitSelectionMode();
  }

  async function bulkRestore() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const { done, failed } = await bulkRun(ids, (id) => notesStore.restore(id));
    toastStore.success($t('notes.multiselect.restored_count', { values: { count: done } }));
    reportPartial(ids.length, done, failed);
    exitSelectionMode();
  }

  async function confirmBulkPermanentDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const { done, failed } = await bulkRun(ids, (id) => notesStore.permanentDelete(id));
    toastStore.success(
      $t('notes.multiselect.permanently_deleted_count', { values: { count: done } })
    );
    reportPartial(ids.length, done, failed);
    exitSelectionMode();
  }

  function openBulkMove() {
    if (selectedIds.size === 0) return;
    bulkMoveSheetOpen = true;
  }

  async function handleBulkMove(folderId: string | null) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    bulkMoveSheetOpen = false;
    const { done, failed } = await bulkRun(ids, (id) => notesStore.move(id, folderId));
    if (folderId === null) {
      toastStore.success($t('notes.multiselect.moved_to_root', { values: { count: done } }));
    } else {
      const folderName =
        buildBreadcrumb($foldersStore, folderId).at(-1)?.name ?? '';
      toastStore.success(
        $t('notes.multiselect.moved_to_folder', { values: { count: done, folder: folderName } })
      );
    }
    reportPartial(ids.length, done, failed);
    // Selection naturally empties if moved-out notes drop out of the current view
    // (e.g. moved to another folder). Keep IDs for cases where user is in "All".
    if (selectedItems.length === 0) exitSelectionMode();
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────
  function onWindowKeydown(e: KeyboardEvent) {
    if (!selectionMode) return;
    const target = e.target as HTMLElement | null;
    const inEditableTarget =
      !!target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable);

    if (e.key === 'Escape') {
      e.preventDefault();
      exitSelectionMode();
      return;
    }
    if (inEditableTarget) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedIds.size === 0) return;
      e.preventDefault();
      if (isTrash) bulkPermanentDeleteDialogOpen = true;
      else bulkDeleteDialogOpen = true;
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      selectAllVisible();
    }
  }

  /**
   * Build a breadcrumb for a note relative to the active folder. Used when search
   * is active in a folder view to show notes from subfolders with their location.
   * Empty string when the note is in the active folder itself or breadcrumb does
   * not apply (no active folder, or note has no folder).
   */
  function getRelativeBreadcrumb(noteFolderId: string | undefined): string {
    if (!searchInput) return '';
    if (activeFolderId === null || activeFolderId === undefined) return '';
    if (!noteFolderId || noteFolderId === activeFolderId) return '';
    const fullPath = buildBreadcrumb($foldersStore, noteFolderId);
    if (fullPath.length === 0) return '';
    const rootIdx = fullPath.findIndex((c) => c.id === activeFolderId);
    const relative = rootIdx === -1 ? fullPath : fullPath.slice(rootIdx + 1);
    return relative.map((c) => c.name).join(' / ');
  }

  const activeMenuNote = $derived(
    menuOpenId ? ($notesStore.find((n) => n.id === menuOpenId) ?? null) : null
  );
  const movingNote = $derived(
    movingNoteId ? ($notesStore.find((n) => n.id === movingNoteId) ?? null) : null
  );

  // Header button sizing — matches the mobile sidebar header (h-11/h-5) when
  // `prominentHeader` is on, smaller (h-9/h-4) for desktop sidebar panes.
  const headerBtnClass = $derived(prominentHeader ? 'h-11 w-11' : 'h-9 w-9');
  const headerIconClass = $derived(prominentHeader ? 'h-5 w-5' : 'h-4 w-4');

  // Row 2 (count + actions, selection toolbar) always uses the prominent
  // sizing on mobile so the tap targets/icons match drill-in views like
  // Favorites/Trash/Folder. Row 1 (title) still follows `prominentHeader`.
  const rowTwoProminent = $derived(prominentHeader || isMobileQuery.value);
  const rowTwoHeight = $derived(rowTwoProminent ? 'h-14' : 'h-10');
  const rowTwoBtnClass = $derived(rowTwoProminent ? 'h-11 w-11' : 'h-9 w-9');
  const rowTwoIconClass = $derived(rowTwoProminent ? 'h-5 w-5' : 'h-4 w-4');

  // ── Active folder action menu + inline rename ─────────────────
  const activeFolder = $derived<FolderWithChildren | null>(
    activeFolderId ? findFolderNode($foldersStore, activeFolderId) : null
  );

  let editingFolderName = $state('');
  let editingActiveFolder = $state(false);
  let editFolderInputEl = $state<HTMLInputElement | undefined>(undefined);

  function startActiveFolderRename() {
    if (!activeFolder) return;
    editingFolderName = activeFolder.name;
    editingActiveFolder = true;
    setTimeout(() => editFolderInputEl?.select(), 0);
  }

  async function commitActiveFolderRename() {
    if (!editingActiveFolder || !activeFolder) return;
    const trimmed = editingFolderName.trim();
    if (trimmed && trimmed !== activeFolder.name) {
      await foldersStore.rename(activeFolder.id, trimmed);
    }
    editingActiveFolder = false;
  }

  function cancelActiveFolderRename() {
    editingActiveFolder = false;
  }

  // Exit rename mode when the active folder changes (navigation away).
  $effect(() => {
    void activeFolderId;
    untrack(() => {
      if (editingActiveFolder) editingActiveFolder = false;
    });
  });
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div class="flex h-full flex-col">
  <!-- Panel header (hidden in searchOnly mode). Two rows:
       row 1 = back + folder name + (in folder view) new-subfolder
       row 2 = note count + actions, OR selection toolbar when multi-select is on. -->
  {#if !searchOnly}
    <!-- Row 1: title + folder-level action. Stays visible during selection. -->
    <div
      class="flex shrink-0 items-center gap-1 {prominentHeader ? 'h-14' : 'h-10'} {onback
        ? 'px-3'
        : 'px-5'}"
    >
      {#if onback}
        <button
          type="button"
          onclick={onback}
          class="flex {headerBtnClass} shrink-0 items-center justify-center rounded-md text-sidebar-foreground
         hover:bg-sidebar-accent transition-colors"
          aria-label={$t('nav.back')}
        >
          <ArrowLeft class={headerIconClass} />
        </button>
      {/if}
      {#if showSidebarTrigger}
        <SidebarTrigger class="md:hidden -ml-1 shrink-0" />
      {/if}
      {#if editingActiveFolder && activeFolder}
        <input
          bind:this={editFolderInputEl}
          bind:value={editingFolderName}
          class="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm caret-primary focus:outline-none focus:ring-1 focus:ring-primary"
          onkeydown={(e) => {
            if (e.key === 'Enter') commitActiveFolderRename();
            if (e.key === 'Escape') cancelActiveFolderRename();
          }}
          onblur={commitActiveFolderRename}
        />
      {:else}
        <span
          class="min-w-0 flex-1 truncate text-sm {prominentHeader
            ? 'font-medium'
            : 'font-normal'}">{activeFolderName}</span
        >
      {/if}

      {#if onNewSubfolder}
        <button
          type="button"
          onclick={onNewSubfolder}
          title={$t('folders.new_subfolder')}
          aria-label={$t('folders.new_subfolder')}
          class="flex {headerBtnClass} shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <FolderPlus class={headerIconClass} />
        </button>
      {/if}

      {#if activeFolder}
        <FolderActionMenu
          folder={activeFolder}
          buttonClass={headerBtnClass}
          iconClass={headerIconClass}
          onNewSubfolder={onNewSubfolder}
          onStartRename={startActiveFolderRename}
          onAfterDelete={onback}
        />
      {/if}
    </div>

    <!-- Row 2: count + per-list actions, swaps to selection toolbar in multi-select. -->
    {#if selectionMode}
      <div
        class="flex shrink-0 items-center gap-1 {rowTwoHeight} {onback ? 'px-3' : 'px-5'}"
        role="toolbar"
        aria-label={$t('notes.multiselect.count', { values: { count: selectedIds.size } })}
      >
        <button
          type="button"
          onclick={exitSelectionMode}
          class="flex {rowTwoBtnClass} shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors"
          aria-label={$t('notes.multiselect.exit')}
          title={$t('notes.multiselect.exit')}
        >
          <X class={rowTwoIconClass} />
        </button>
        <span class="min-w-0 flex-1 truncate text-sm font-medium">
          {$t('notes.multiselect.count', { values: { count: selectedIds.size } })}
        </span>

        {#if isTrash}
          <button
            type="button"
            onclick={bulkRestore}
            disabled={selectedIds.size === 0}
            class="flex {rowTwoBtnClass} shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:pointer-events-none disabled:opacity-40"
            aria-label={$t('notes.multiselect.restore_all')}
            title={$t('notes.multiselect.restore_all')}
          >
            <RotateCcw class={rowTwoIconClass} />
          </button>
          <button
            type="button"
            onclick={() => (bulkPermanentDeleteDialogOpen = true)}
            disabled={selectedIds.size === 0}
            class="flex {rowTwoBtnClass} shrink-0 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:pointer-events-none disabled:opacity-40"
            aria-label={$t('notes.multiselect.permanent_delete_all')}
            title={$t('notes.multiselect.permanent_delete_all')}
          >
            <Trash class={rowTwoIconClass} />
          </button>
        {:else}
          <button
            type="button"
            onclick={bulkPin}
            disabled={selectedIds.size === 0}
            class="flex {rowTwoBtnClass} shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:pointer-events-none disabled:opacity-40"
            aria-label={allPinned
              ? $t('notes.multiselect.unpin_all')
              : $t('notes.multiselect.pin_all')}
            title={allPinned
              ? $t('notes.multiselect.unpin_all')
              : $t('notes.multiselect.pin_all')}
          >
            {#if allPinned}
              <PinOff class={rowTwoIconClass} />
            {:else}
              <Pin class={rowTwoIconClass} />
            {/if}
          </button>
          <button
            type="button"
            onclick={bulkStar}
            disabled={selectedIds.size === 0}
            class="flex {rowTwoBtnClass} shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:pointer-events-none disabled:opacity-40"
            aria-label={allStarred
              ? $t('notes.multiselect.unstar_all')
              : $t('notes.multiselect.star_all')}
            title={allStarred
              ? $t('notes.multiselect.unstar_all')
              : $t('notes.multiselect.star_all')}
          >
            {#if allStarred}
              <StarOff class={rowTwoIconClass} />
            {:else}
              <Star class={rowTwoIconClass} />
            {/if}
          </button>
          <button
            type="button"
            onclick={openBulkMove}
            disabled={selectedIds.size === 0}
            class="flex {rowTwoBtnClass} shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:pointer-events-none disabled:opacity-40"
            aria-label={$t('notes.multiselect.move_all')}
            title={$t('notes.multiselect.move_all')}
          >
            <FolderInput class={rowTwoIconClass} />
          </button>
          <button
            type="button"
            onclick={() => (bulkDeleteDialogOpen = true)}
            disabled={selectedIds.size === 0}
            class="flex {rowTwoBtnClass} shrink-0 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:pointer-events-none disabled:opacity-40"
            aria-label={$t('notes.multiselect.delete_all')}
            title={$t('notes.multiselect.delete_all')}
          >
            <Trash2 class={rowTwoIconClass} />
          </button>
        {/if}
      </div>
    {:else}
      <div
        class="flex {rowTwoHeight} shrink-0 items-center gap-1 pl-5 {onback ? 'pr-3' : 'pr-5'}"
      >
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {$t('notes.notes_count', { values: { count: $notesStore.length } })}
        </span>

        {#if $notesStore.length > 0}
          <button
            type="button"
            onclick={toggleSelectionMode}
            title={$t('notes.multiselect.enter')}
            aria-label={$t('notes.multiselect.enter')}
            class="flex {rowTwoBtnClass} shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ListChecks class={rowTwoIconClass} />
          </button>
        {/if}

        {#if !isTrash}
          <NoteListSortMenu bind:sortSheetOpen prominent={rowTwoProminent} />
        {/if}

        {#if !isTrash && !isPeriodic}
          <button
            type="button"
            onclick={handleCreate}
            title={$t('nav.new_note')}
            aria-label={$t('nav.new_note')}
            class="flex {rowTwoBtnClass} shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <FilePlus class={rowTwoIconClass} />
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
  {/if}

  <!-- Search bar -->
  <NoteListSearchBar bind:searchInput bind:searchInContent bind:searchInputEl {searchOnly} />

  <!-- Notes list -->
  <div class="flex-1 overflow-y-auto px-3">
    {#if !searchInput && !searchOnly}
      <SubfolderList
        {subfolders}
        parentId={activeFolderId}
        onselect={(id) => onSubfolderSelect?.(id)}
      />
    {/if}
    {#if searchOnly && !searchInput}
      <div class="px-4 py-12 text-center">
        <Search class="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
        <p class="text-sm text-muted-foreground">{$t('notes.search_hint')}</p>
      </div>
    {:else if $notesStore.length === 0}
      {#if subfolders.length === 0 || searchInput}
        <div class="px-4 py-8 text-center">
          {#if searchInput}
            <p class="text-sm text-muted-foreground">
              {#if activeFolderId && activeFolderName}
                {$t('notes.no_match_in_folder', {
                  values: { query: searchInput, folder: activeFolderName }
                })}
              {:else}
                {$t('notes.no_match', { values: { query: searchInput } })}
              {/if}
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
          {:else if $isInitialSync}
            <p class="text-sm text-muted-foreground">{$t('sync_status.initial.title')}</p>
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
      {/if}
    {:else}
      <ul class="flex flex-col gap-2 py-1">
        {#each visibleNotes as note (note.id)}
          <NoteListItemComponent
            {note}
            {isTrash}
            breadcrumb={getRelativeBreadcrumb(note.folder_id)}
            bind:movingNoteId
            {selectionMode}
            isSelected={selectedIds.has(note.id)}
            onenterselection={() => enterSelectionMode(note.id)}
            ontoggleselect={(opts) => toggleSelection(note.id, opts)}
            onmenuopen={handleMenuOpen}
            onpin={handleTogglePin}
            onstar={handleToggleStar}
            onmove={handleMove}
            onexport={handleExportNote}
            oncopylink={handleCopyNoteLink}
            onshare={handleShare}
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
  onshare={(note) => handleShare(note)}
  ondelete={handleDelete}
  onrestore={handleRestore}
  onpermanentdelete={handlePermanentDelete}
/>

<!-- Mobile: Move to folder Sheet -->
{#if isMobileQuery.value}
  <MoveToFolderMenu
    selection={movingNoteId
      ? { kind: 'single', id: movingNoteId, currentFolderId: movingNote?.folder_id ?? null }
      : null}
    bind:open={moveSheetOpen}
    onmove={(folderId, e) => movingNoteId && handleMove(movingNoteId, folderId, e)}
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

<!-- Bulk: move-to-folder picker (bottom sheet on both desktop and mobile —
     no per-item anchor for an absolute desktop popup) -->
<MoveToFolderMenu
  selection={selectedIds.size > 0
    ? { kind: 'multi', count: selectedIds.size }
    : null}
  bind:open={bulkMoveSheetOpen}
  forceSheet
  onmove={(folderId) => handleBulkMove(folderId)}
  onclose={() => (bulkMoveSheetOpen = false)}
/>

<!-- Bulk: delete confirmation (active view → move to trash) -->
<ConfirmDialog
  bind:open={bulkDeleteDialogOpen}
  title={$t('notes.multiselect.bulk_delete_title', { values: { count: selectedIds.size } })}
  description={$t('notes.multiselect.bulk_delete_desc')}
  confirmText={$t('notes.multiselect.delete_all')}
  destructive
  onConfirm={confirmBulkDelete}
/>

<!-- Bulk: permanent delete confirmation (trash view) -->
<ConfirmDialog
  bind:open={bulkPermanentDeleteDialogOpen}
  title={$t('notes.multiselect.bulk_permanent_delete_title', {
    values: { count: selectedIds.size }
  })}
  description={$t('notes.multiselect.bulk_permanent_delete_desc')}
  confirmText={$t('notes.multiselect.permanent_delete_all')}
  destructive
  onConfirm={confirmBulkPermanentDelete}
/>

{#if shareNoteId}
  <ShareNoteDialog bind:open={shareDialogOpen} noteId={shareNoteId} noteTitle={shareNoteTitle} />
{/if}
