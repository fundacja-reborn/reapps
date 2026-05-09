<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { base } from '$app/paths';
  import { SvelteSet } from 'svelte/reactivity';
  import { FolderPlus, Plus, ArrowLeft, Lock } from '@lucide/svelte';

  // Layout
  import IconNav, { type Section, isPeriodicSection } from '$lib/components/layout/IconNav.svelte';
  import SidebarAutoClose from '$lib/components/layout/SidebarAutoClose.svelte';
  import SyncStatusFooter from '$lib/components/sync/SyncStatusFooter.svelte';
  import InitialSyncState from '$lib/components/sync/InitialSyncState.svelte';
  import { isInitialSync } from '$lib/stores/sync-status.store';
  import {
    SidebarProvider,
    Sidebar,
    SidebarHeader,
    SidebarContent,
    SidebarInset,
    SidebarTrigger
  } from '@reborn/ui/sidebar';
  import * as Tooltip from '@reborn/ui/components/tooltip';

  // Content components
  import NoteList from '$lib/components/NoteList.svelte';
  import NotePicker from '$lib/components/NotePicker.svelte';

  import VersionHistorySheet from '$lib/components/VersionHistorySheet.svelte';
  import FolderTree, { pendingRenameId } from '$lib/components/sidebar/FolderTree.svelte';
  import ConfirmDialog from '$lib/components/shared/ConfirmDialog.svelte';
  import NoteEditor from '$lib/components/NoteEditor.svelte';

  // Extracted components
  import NoteEditorHeader from '$lib/components/editor/NoteEditorHeader.svelte';
  import HistoryHeader from '$lib/components/editor/HistoryHeader.svelte';
  import NoteContentArea from '$lib/components/editor/NoteContentArea.svelte';
  import NoteDetailActions from '$lib/components/editor/NoteDetailActions.svelte';
  import NoteMetadataBar from '$lib/components/editor/NoteMetadataBar.svelte';
  import NoteActionSheet from '$lib/components/notes/NoteActionSheet.svelte';
  import MoveToFolderMenu from '$lib/components/notes/MoveToFolderMenu.svelte';
  import TagSidebarSection from '$lib/components/tags/TagSidebarSection.svelte';
  import TagListMobile from '$lib/components/tags/TagListMobile.svelte';
  import TagActionSheet from '$lib/components/tags/TagActionSheet.svelte';

  // Stores / services
  import { notesStore, activeNoteId, type NoteListItem } from '$lib/stores/notes.store';
  import * as NoteService from '$lib/services/note.service';
  import { exportNoteAsMarkdown, exportNoteAsPdf } from '$lib/services/export-import.service';
  import * as PeriodicNotesService from '$lib/services/periodic-notes.service';
  import type { PeriodicKind } from '@reborn/storage';
  import { foldersStore } from '$lib/stores/folders.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { getSettings } from '$lib/utils/app-settings';
  import {
    appSettings,
    imageLoadMode,
    editorModeIntroSeen,
    periodicNotesSettings
  } from '$lib/stores/app-settings.store';
  import EditorModeIntroDialog from '$lib/components/editor/EditorModeIntroDialog.svelte';
  import PeriodicNoteOnboardingDialog from '$lib/components/editor/PeriodicNoteOnboardingDialog.svelte';
  import type { EditorMode } from '@reborn/storage';
  import { t } from '$lib/stores/i18n.store';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import { noteIndex } from '$lib/services/note-index.svelte';
  import { tagManager } from '$lib/services/tag-manager.svelte';
  import { toastStore } from '@reborn/ui';
  import {
    flattenFolderTree,
    getAncestorIds,
    findChildrenOfParent
  } from '$lib/utils/folder-helpers';
  import { goto } from '$lib/utils/navigation';
  import { createScrollSync } from '$lib/utils/scroll-sync';
  import { createEditorAdapter, createPreviewAdapter } from '$lib/utils/line-adapter';
  import type { EditorView } from '@codemirror/view';

  type ViewMode = 'edit' | 'split' | 'preview';

  // ── Section / nav state ──────────────────────────────────────────
  let activeSection = $state<Section>('all');
  let activeFolderId = $state<string | null | undefined>(undefined);
  let activeTagId = $state<string | null>(null);
  // Last folder the user visited — used to scroll the folder tree back to that
  // node after exiting all the way up to the tree root, so deep trees keep context.
  let lastVisitedFolderId = $state<string | null>(null);
  const activeStarred = $derived(activeSection === 'starred');
  const activeTrash = $derived(activeSection === 'trash');
  const activeFolderSubfolders = $derived(
    activeSection === 'folders' && activeFolderId
      ? findChildrenOfParent($foldersStore, activeFolderId)
      : []
  );
  const activeFolderParentId = $derived(
    activeSection === 'folders' && activeFolderId
      ? (getAncestorIds(activeFolderId, $foldersStore)[0] ?? null)
      : null
  );

  // ── Tag: mobile new tag input focus ────────────────────────────
  let mobileNewTagInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (tagManager.creatingTag && mobileNewTagInput) {
      mobileNewTagInput.focus();
    }
  });

  // Folder tree expand state
  let expandedIds = new SvelteSet<string>();

  // Permanent delete dialog (toolbar)
  let permanentDeleteDialogOpen = $state(false);

  // ── Detail-view action menu (kebab in tag bar) ────────────────
  let detailActionSheetOpen = $state(false);
  let detailMoveSheetOpen = $state(false);
  let detailMovingNoteId = $state<string | null>(null);
  let detailDeleteDialogOpen = $state(false);

  const detailMenuNote = $derived(
    $activeNoteId ? ($notesStore.find((n) => n.id === $activeNoteId) ?? null) : null
  );

  // Tag the open note with its periodic kind (if any) so the editor can swap
  // its placeholder for kind-aware copy ("Zacznij pisać dzisiejszą notatkę…").
  // Match by folder ID. Read from `detailMenuNote.folder_id` (the reactive
  // notesStore lookup), NOT from `noteDetailService.folderId` — the service
  // populates folderId asynchronously inside loadNote(), so on the first render
  // after activeNoteId.set(...) it would still be the previous note's value
  // and the editor would lock in the wrong placeholder.
  const currentNoteKind = $derived.by((): PeriodicKind | null => {
    const folderId = detailMenuNote?.folder_id;
    if (!folderId) return null;
    const settings = $periodicNotesSettings;
    if (settings.daily.folderId === folderId) return 'daily';
    if (settings.weekly.folderId === folderId) return 'weekly';
    if (settings.monthly.folderId === folderId) return 'monthly';
    return null;
  });

  // First-use onboarding modal — open with the kind that triggered it.
  let periodicOnboardingKind = $state<PeriodicKind | null>(null);

  async function handleDetailPin() {
    detailActionSheetOpen = false;
    if (!$activeNoteId) return;
    await notesStore.togglePin($activeNoteId);
  }

  async function handleDetailStar() {
    detailActionSheetOpen = false;
    if (!$activeNoteId) return;
    await notesStore.toggleStar($activeNoteId);
  }

  function handleDetailOpenMoveMobile() {
    detailActionSheetOpen = false;
    if (!$activeNoteId) return;
    detailMovingNoteId = $activeNoteId;
    detailMoveSheetOpen = true;
  }

  async function handleDetailMoveDesktop(folderId: string | null, e?: Event) {
    e?.stopPropagation();
    if (!$activeNoteId) return;
    await notesStore.move($activeNoteId, folderId);
    noteDetailService.folderId = folderId;
  }

  async function handleDetailMoveMobile(noteId: string, folderId: string | null, e?: Event) {
    e?.stopPropagation();
    detailMoveSheetOpen = false;
    detailMovingNoteId = null;
    await notesStore.move(noteId, folderId);
    if (noteId === $activeNoteId) noteDetailService.folderId = folderId;
  }

  async function handleDetailExport(noteArg?: NoteListItem) {
    detailActionSheetOpen = false;
    const target = noteArg ?? detailMenuNote;
    if (!target) return;
    const fullNote = await NoteService.getNote(target.id);
    if (!fullNote) {
      toastStore.error($t('notes.export_failed'));
      return;
    }
    const tagNames = $tagsStore.filter((tg) => target.tags?.includes(tg.id)).map((tg) => tg.name);
    exportNoteAsMarkdown(fullNote, tagNames);
  }

  async function handleDetailExportPdf(noteArg?: NoteListItem) {
    detailActionSheetOpen = false;
    const target = noteArg ?? detailMenuNote;
    if (!target) return;
    const fullNote = await NoteService.getNote(target.id);
    if (!fullNote) {
      toastStore.error($t('notes.export_failed'));
      return;
    }
    try {
      await exportNoteAsPdf(fullNote);
    } catch {
      toastStore.error($t('notes.export_failed'));
    }
  }

  async function handleDetailCopyLink(noteArg?: NoteListItem) {
    detailActionSheetOpen = false;
    const target = noteArg ?? detailMenuNote;
    if (!target) return;
    const title = target.title || $t('notes.untitled');
    const link = `[${title}](note:${target.id})`;
    try {
      await navigator.clipboard.writeText(link);
      toastStore.success($t('notes.note_link_copied'));
    } catch {
      toastStore.error('Failed to copy');
    }
  }

  function handleDetailDelete() {
    detailActionSheetOpen = false;
    detailDeleteDialogOpen = true;
  }

  function handleDetailHistory() {
    detailActionSheetOpen = false;
    historyMode = historyMode === 'closed' ? 'list' : 'closed';
    if (historyMode === 'closed') {
      resetHistoryState();
    }
  }

  async function confirmDetailDelete() {
    if (!$activeNoteId) return;
    const id = $activeNoteId;
    await notesStore.remove(id);
    activeNoteId.set(null);
  }

  // Save-error dialog (shown when flush fails before navigation)
  let saveErrorDialogOpen = $state(false);
  let pendingNavigationAction: (() => void) | null = null;

  // ── Editor ──────────────────────────────────────────────────────
  let viewMode = $state<ViewMode>('edit');
  type HistoryMode = 'closed' | 'list' | 'diff';
  let historyMode = $state<HistoryMode>('closed');
  let selectedVersion = $state<import('@reborn/types').NoteHistoryDecrypted | null>(null);
  let previousVersion = $state<import('@reborn/types').NoteHistoryDecrypted | null>(null);
  let historyViewMode = $state<'preview' | 'diff'>('preview');
  let restoreDialogOpen = $state(false);
  let isLatestVersion = $state(false);
  let showEncryptionXRay = $state(false);

  // ── Scroll & title visibility (desktop + mobile) ────────────────
  let desktopTitleVisible = $state(true);
  let desktopTitleSentinel = $state<HTMLDivElement>();

  $effect(() => {
    const el = desktopTitleSentinel;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        desktopTitleVisible = entry.isIntersecting;
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  });

  let mobileTitleVisible = $state(true);
  let mobileTitleSentinel = $state<HTMLDivElement>();

  $effect(() => {
    const el = mobileTitleSentinel;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        mobileTitleVisible = entry.isIntersecting;
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  });

  // ── Mobile ──────────────────────────────────────────────────────
  let isMobile = $state(false);
  let closeSidebarSignal = $state(0);
  const effectiveViewMode = $derived(isMobile && viewMode === 'split' ? 'edit' : viewMode);

  // Mobile drill-down navigation state
  type MobileView = 'list' | 'folder-tree' | 'tag-list';
  let mobileView = $state<MobileView>('list');

  // ── Mobile: virtual history for native back gesture ────────────
  let mobileHistoryDepth = 0;
  let skipPopstateCount = 0;

  function pushMobileHistory() {
    if (!isMobile) return;
    history.pushState({ _rn: 'app' }, '');
    mobileHistoryDepth++;
  }

  function resetMobileHistory() {
    if (mobileHistoryDepth > 0) {
      skipPopstateCount += mobileHistoryDepth;
      history.go(-mobileHistoryDepth);
      mobileHistoryDepth = 0;
    }
  }

  /** Navigate one level up based on current app state. Called by popstate handler. */
  function navigateUp() {
    if ($activeNoteId != null) {
      noteDetailService.flushAndSnapshot();
      activeNoteId.set(null);
    } else if (mobileView === 'list' && activeSection === 'folders' && activeFolderId !== undefined) {
      void exitCurrentFolder();
    } else if (mobileView === 'list' && activeSection === 'tags' && activeTagId !== null) {
      activeTagId = null;
      activeNoteId.set(null);
      mobileView = 'tag-list';
    } else if (mobileView === 'folder-tree' || mobileView === 'tag-list') {
      mobileView = 'list';
      activeSection = 'all';
    }
  }

  // Sync mobileView when the user switches sections via IconNav.
  // Track previous value so this only fires on real section changes — drilling
  // into a folder/tag updates mobileView from its own handler and we must not
  // overwrite that here. (isMobile flipping on resize would otherwise wipe the
  // user's drill-down state.)
  let prevSectionForView: Section | null = null;
  $effect(() => {
    const section = activeSection;
    if (section === prevSectionForView) return;
    prevSectionForView = section;
    if (!isMobile) return;
    if (section === 'folders') {
      mobileView = 'folder-tree';
    } else if (section === 'tags') {
      mobileView = 'tag-list';
    } else {
      mobileView = 'list';
    }
  });

  // Scroll the folder tree to the last visited folder when we land on the
  // tree view (e.g., after backing out of a deep branch). Otherwise large trees
  // always reset to top and lose context.
  let prevMobileView: MobileView = 'list';
  $effect(() => {
    const view = mobileView;
    const target = lastVisitedFolderId;
    if (view !== prevMobileView && view === 'folder-tree' && isMobile && target) {
      tick().then(() => {
        const el = document.querySelector(`[data-folder-id="${CSS.escape(target)}"]`);
        el?.scrollIntoView({ block: 'center', behavior: 'auto' });
      });
    }
    prevMobileView = view;
  });

  function handleMobileBack() {
    if (isMobile && mobileHistoryDepth > 0) {
      history.back();
    } else {
      navigateUp();
    }
  }

  // ── Mobile: swipe-back gesture ─────────────────────────────────
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swiping = false;

  function handleSwipeStart(e: TouchEvent) {
    const touch = e.touches[0];
    if (touch.clientX < 30) {
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
      swiping = true;
    }
  }

  async function handleSwipeEnd(e: TouchEvent) {
    if (!swiping) return;
    swiping = false;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - swipeStartY);
    if (dx > 80 && dy < 50) {
      if (isMobile && mobileHistoryDepth > 0) {
        history.back();
      } else {
        await noteDetailService.flushAndSnapshot();
        activeNoteId.set(null);
      }
    }
  }

  // ── Mobile: push history when note opens ───────────────────────
  let prevNoteIdForHistory: string | null = null;
  $effect(() => {
    const id = $activeNoteId;
    if (isMobile && id != null && prevNoteIdForHistory == null) {
      pushMobileHistory();
    }
    prevNoteIdForHistory = id;
  });

  // ── Derived: should main area show note list? ──────────────────
  const showNoteListInMain = $derived(
    (activeSection === 'folders' && activeFolderId !== undefined) ||
      (activeSection === 'tags' && activeTagId !== null)
  );

  /** Mobile-only: sections where NoteList renders its own prominent (h-12) header,
   *  so the master mobile wrapper header should be skipped. Includes drill-down
   *  folder/tag selections and any flat-list view (starred, trash, periodic). */
  const noteListOwnsMobileHeader = $derived(
    activeSection === 'starred' ||
      activeSection === 'trash' ||
      isPeriodicSection(activeSection) ||
      (activeSection === 'folders' && activeFolderId !== undefined) ||
      (activeSection === 'tags' && activeTagId !== null)
  );

  // ── Derived labels ───────────────────────────────────────────────
  const activeFolderName = $derived.by(() => {
    if (activeSection === 'search') return $t('nav.search');
    if (activeSection === 'trash') return $t('nav.trash');
    if (activeSection === 'starred') return $t('nav.starred');
    if (activeSection === 'all') return $t('nav.all_notes');
    if (activeSection === 'tags') {
      const tag = $tagsStore.find((t) => t.id === activeTagId);
      return tag ? tag.name : $t('nav.tags');
    }
    if (isPeriodicSection(activeSection)) {
      const kind = activeSection.replace('periodic-', '') as PeriodicKind;
      // Prefer the actual folder name (user may have renamed it); fall back to the
      // i18n default which matches what PeriodicNotesService creates lazily.
      if (activeFolderId) {
        const folder = flattenFolderTree($foldersStore).find((f) => f.id === activeFolderId);
        if (folder) return folder.name;
      }
      return $t(`notes.periodic.${kind}.folder.default`);
    }
    if (activeFolderId === undefined) return $t('nav.all_notes');
    if (activeFolderId === null) return $t('nav.no_folder');
    return (
      flattenFolderTree($foldersStore).find((f) => f.id === activeFolderId)?.name ??
      $t('nav.folders')
    );
  });

  let activeNoteFolderName = $derived.by(() => {
    if (!$activeNoteId || noteDetailService.folderId == null) return null;
    return (
      flattenFolderTree($foldersStore).find((f) => f.id === noteDetailService.folderId)?.name ??
      null
    );
  });

  // ── Sync store filters to nav state ─────────────────────────────
  let prevSection: Section | null = null;
  $effect(() => {
    const section = activeSection;
    const sectionUsesFolderId = section === 'folders' || isPeriodicSection(section);
    const folderId = sectionUsesFolderId ? activeFolderId : undefined;
    const tagId = activeSection === 'tags' ? activeTagId : null;

    if (section !== prevSection) {
      untrack(() => {
        // Reset mobile history stack when switching sections via IconNav
        if (isMobile) resetMobileHistory();

        // Only periodic transitions arrive with an already-set activeFolderId
        // (handlePeriodic sets it in the same batch). Clearing for everything else
        // covers folders→folders is impossible (no transition), periodic→folders
        // (must drop the periodic folder id), and any→all/starred/etc.
        if (!isPeriodicSection(section)) activeFolderId = undefined;
        if (section !== 'tags') {
          activeTagId = null;
          tagManager.resetSection();
        }
        // Periodic sections own activeNoteId via handlePeriodic — don't clear it
        // here or the freshly-opened periodic note would deselect on first paint.
        if (!isPeriodicSection(section)) {
          noteDetailService.flushAndSnapshot().then(() => activeNoteId.set(null));
        }

        // Push history entry for drill-down sections (folders/tags)
        if (isMobile && (section === 'folders' || section === 'tags')) {
          pushMobileHistory();
        }
      });
      prevSection = section;
    }

    // untrack: store updates are write-only side effects —
    // this effect should only react to section/folder/tag changes, not store internals.
    untrack(() => {
      if (section === 'trash') {
        notesStore.setTrash(true);
      } else if (section === 'starred') {
        notesStore.setStarred(true);
      } else if (section === 'tags' && tagId) {
        notesStore.setTag(tagId);
      } else if (sectionUsesFolderId) {
        notesStore.setFolder(folderId);
      } else {
        notesStore.setFolder(undefined);
      }
    });
  });

  // Load note content when active note changes
  let prevNoteId: string | null = null;
  $effect(() => {
    const id = $activeNoteId;
    historyMode = 'closed';
    selectedVersion = null;
    previousVersion = null;
    historyViewMode = 'preview';
    showEncryptionXRay = false;

    const prev = prevNoteId;
    prevNoteId = id;

    if (!id) {
      if (prev) {
        untrack(() => noteDetailService.flushAndSnapshot(prev));
      }
      untrack(() => noteDetailService.reset());
      return;
    }

    if (untrack(() => noteDetailService.isNewNote)) {
      viewMode = 'edit';
    } else {
      viewMode = 'preview';
    }
    untrack(() => noteDetailService.loadNote(id));
  });

  // ── New note ─────────────────────────────────────────────────────
  let editorModeIntroOpen = $state(false);

  async function handleNewNote() {
    if (!$editorModeIntroSeen) {
      editorModeIntroOpen = true;
      return;
    }

    // Trash/starred/tags filter out a freshly created note (no deletion / star /
    // tag yet), so the user would create a note and see nothing. Switch to "All
    // notes" first and await tick so the section $effect drives the store filter
    // before we call create() + refresh().
    if (
      activeSection === 'trash' ||
      activeSection === 'starred' ||
      activeSection === 'tags' ||
      isPeriodicSection(activeSection)
    ) {
      activeSection = 'all';
      activeFolderId = undefined;
      activeTagId = null;
      await tick();
    }
    const date = new Date().toISOString().slice(0, 10);
    const settings = await getSettings();
    const prefix = settings?.language === 'pl' ? 'Notatka' : 'Note';
    const id = await notesStore.create(`${prefix} ${date}`, '');
    noteDetailService.setNewNote();
    activeNoteId.set(id);
  }

  async function handlePeriodic(kind: PeriodicKind) {
    try {
      // Service guarantees the folder exists and settings.folderId is populated
      // after the await, so we can safely read it for the sidebar filter.
      const { noteId, created } = await PeriodicNotesService.getOrCreateNote(kind);

      const folderId = $periodicNotesSettings[kind].folderId ?? undefined;
      activeSection = `periodic-${kind}` as Section;
      activeFolderId = folderId;
      activeTagId = null;
      await tick();

      if (created) {
        noteDetailService.setNewNote();
      }
      activeNoteId.set(noteId);
      // First-use onboarding: only on actual creation (not "open existing")
      // and only if the user hasn't dismissed it on this device yet.
      if (created && !$periodicNotesSettings[kind].onboardingDismissed) {
        periodicOnboardingKind = kind;
      }
    } catch (err) {
      const message = $t(`notes.periodic.errors.failed`);
      toastStore.error(message);
      console.error('[periodic-notes] failed to open', kind, err);
    }
  }

  async function handlePeriodicOnboardingClose() {
    const kind = periodicOnboardingKind;
    periodicOnboardingKind = null;
    if (!kind) return;
    // Persist via the derived store's defensive merge so legacy stored
    // settings without `onboardingDismissed` get the full shape written back.
    const next = structuredClone($periodicNotesSettings);
    next[kind].onboardingDismissed = true;
    await appSettings.update('periodicNotes', next);
  }

  async function handleEditorModeIntroClose(chosen: EditorMode | null) {
    if (chosen) {
      await appSettings.update('editorMode', chosen);
    }
    await appSettings.update('editorModeIntroSeen', true);
    editorModeIntroOpen = false;
    await handleNewNote();
  }

  // ── Folder management ────────────────────────────────────────────
  async function handleNewFolder() {
    const id = await foldersStore.create($t('folders.new_folder'));
    pendingRenameId.set(id);
  }

  async function handleSectionClick(section: Section) {
    // Fires on every IconNav click. Resets sub-selection when re-clicking the
    // already-active section so users can always get back to the section root.
    if (section !== activeSection) return;
    if (section === 'folders' && activeFolderId !== undefined) {
      await noteDetailService.flushAndSnapshot();
      if (isMobile) resetMobileHistory();
      activeFolderId = undefined;
      activeNoteId.set(null);
      if (isMobile) {
        mobileView = 'folder-tree';
        pushMobileHistory();
      }
    } else if (section === 'tags' && activeTagId !== null) {
      await noteDetailService.flushAndSnapshot();
      if (isMobile) resetMobileHistory();
      activeTagId = null;
      activeNoteId.set(null);
      if (isMobile) {
        mobileView = 'tag-list';
        pushMobileHistory();
      }
    }
  }

  /** State-only part of selecting a folder. Does NOT push history — caller decides. */
  async function applyFolderSelection(id: string | null | undefined) {
    await noteDetailService.flushAndSnapshot();
    activeFolderId = id;
    activeNoteId.set(null);
    if (id) {
      lastVisitedFolderId = id;
      getAncestorIds(id, $foldersStore).forEach((ancestorId) => expandedIds.add(ancestorId));
      expandedIds.add(id);
    }
  }

  /** User taps a folder (in tree or as a subfolder card) — drill down. */
  async function handleFolderSelect(id: string | null) {
    await applyFolderSelection(id);
    if (isMobile) {
      mobileView = 'list';
      pushMobileHistory();
    } else {
      closeSidebarSignal++;
    }
  }

  /** Drill up by one level: sub-folder → its parent, top-level folder → tree root. */
  async function exitCurrentFolder() {
    if (activeFolderParentId) {
      await applyFolderSelection(activeFolderParentId);
      if (isMobile) mobileView = 'list';
    } else {
      await applyFolderSelection(undefined);
      if (isMobile) mobileView = 'folder-tree';
    }
  }

  function handleFolderBack() {
    void exitCurrentFolder();
  }

  async function handleTagSelect(tagId: string) {
    await noteDetailService.flushAndSnapshot();
    activeTagId = tagId;
    activeNoteId.set(null);
    if (isMobile) {
      mobileView = 'list';
      pushMobileHistory();
    } else {
      closeSidebarSignal++;
    }
  }

  // ── Autosave (delegated to noteDetailService) ─────────────────
  function handleContentChange(content: string) {
    noteDetailService.setContentDebounced(content);
  }

  function handleTitleInput(e: Event) {
    noteDetailService.setTitleDebounced((e.target as HTMLInputElement).value);
  }

  async function handleRestoreVersion(title: string, content: string) {
    await noteDetailService.restoreVersion(title, content);
  }

  // ── History helpers ──────────────────────────────────────────────
  function resetHistoryState() {
    selectedVersion = null;
    previousVersion = null;
    historyViewMode = 'preview';
    isLatestVersion = false;
  }

  function closeHistory() {
    historyMode = 'closed';
    resetHistoryState();
  }

  // ── Internal note links ──────────────────────────────────────────
  async function handleNoteLink(noteId: string) {
    await noteDetailService.flushAndSnapshot();
    const note = await notesStore.loadNote(noteId);
    if (!note) {
      toastStore.error($t('notes.note_not_found'));
      return;
    }
    if (note.is_archived) {
      toastStore.info($t('notes.note_in_trash'));
      return;
    }
    activeNoteId.set(noteId);
  }

  function resolveNoteTitle(noteId: string): string | undefined {
    return noteIndex.getTitle(noteId);
  }

  // ── Note link picker ─────────────────────────────────────────────
  let notePickerOpen = $state(false);
  let notePickerNotes = $state<{ id: string; title: string }[]>([]);
  let editorRef = $state<NoteEditor | null>(null);

  const autocompleteNotes = $derived(noteIndex.getAll());

  async function openNotePicker() {
    notePickerNotes = noteIndex.getAll();
    notePickerOpen = true;
  }

  function handleNotePickerSelect(noteId: string, title: string) {
    editorRef?.insertNoteLink(noteId, title);
  }

  // ── Scroll sync (line-anchored) ───────────────────────────────────
  // One mechanism, three jobs:
  //   • toggle preservation (Edit ↔ Preview ↔ Live) keeps the same source
  //     line at the top of the viewport across remounts
  //   • Live ↔ Markdown editor-mode toggle (the editor remounts internally
  //     via Compartment, so its viewport is preserved by CM6 itself — but
  //     the anchor is still maintained for the next view-mode toggle)
  //   • split view continuously syncs editor and preview to each other
  //
  // Adapters are line-based (line N at top → line N at top), which is the
  // only model that survives height asymmetry between the panes (images,
  // code blocks, headings).
  const scrollSync = createScrollSync();
  let previewScrollEl = $state<HTMLElement | null>(null);
  let previewContentEl = $state<HTMLElement | null>(null);
  let editorView = $state<EditorView | null>(null);
  let desktopEditorScrollContainer = $state<HTMLElement | null>(null);
  let mobileScrollContainer = $state<HTMLElement | null>(null);

  /**
   * Pick the actual scroll source for the editor pane:
   *   - split view: each pane owns its scroll, so it's the cm-scroller
   *   - single-pane parentScroll: the outer flex container scrolls
   * Reading via $derived so the effect below re-runs when split toggles
   * or the user rotates between mobile/desktop.
   */
  const editorScrollEl = $derived.by<HTMLElement | null>(() => {
    if (!editorView) return null;
    if (effectiveViewMode === 'split') return editorView.scrollDOM;
    return isMobile ? mobileScrollContainer : desktopEditorScrollContainer;
  });

  /**
   * Same idea for the preview pane. In split view its container scrolls
   * itself; in single-pane mode the parent does.
   */
  const previewSyncScrollEl = $derived.by<HTMLElement | null>(() => {
    if (!previewContentEl) return null;
    if (effectiveViewMode === 'split') return previewScrollEl;
    return isMobile ? mobileScrollContainer : desktopEditorScrollContainer;
  });

  // Reset both the abstract anchor AND the parent scroll container's
  // scrollTop whenever we open a different note. NoteEditor/MarkdownPreview
  // are not remounted on note change (they just receive a new content prop),
  // so the shared scroll container retains its scrollTop from the previous
  // note — without this reset, Note B would open at Note A's scroll position.
  //
  // The container/view refs are read inside `untrack` so the effect depends
  // ONLY on `$activeNoteId`. Otherwise toggling Edit ↔ Preview within the
  // same note (which flips `editorView` / `previewContentEl` references as
  // panes mount/unmount) would re-fire this effect, calling setAnchor(1)
  // and zeroing scrollTop — defeating toggle preservation.
  $effect(() => {
    void $activeNoteId;
    untrack(() => {
      scrollSync.setAnchor(1);
      if (desktopEditorScrollContainer) desktopEditorScrollContainer.scrollTop = 0;
      if (mobileScrollContainer) mobileScrollContainer.scrollTop = 0;
      if (previewScrollEl) previewScrollEl.scrollTop = 0;
      if (editorView) editorView.scrollDOM.scrollTop = 0;
    });
  });

  // Editor adapter lifecycle. Re-runs when `editorView` is (re)created or
  // when `editorScrollEl` changes (e.g. split ↔ single switches the source).
  $effect(() => {
    if (!editorView || !editorScrollEl) {
      scrollSync.setEditor(null);
      return;
    }
    const view = editorView;
    const adapter = createEditorAdapter(view, editorScrollEl);
    scrollSync.setEditor(adapter);
    // Restore via CM6's measure cycle: `lineBlockAt(...)` reads from
    // CM6's height cache, which is only populated on the rAF-scheduled
    // measure pass. A microtask fires *before* that pass, so on first
    // mount (Preview → Edit toggle) we'd be reading height-oracle
    // estimates and landing several lines off — the more wrapping or
    // widgets in the doc, the bigger the drift. `requestMeasure({write})`
    // runs after the measure cycle so heights are real.
    view.requestMeasure({
      read: () => null,
      write: () => scrollSync.restoreTo('editor')
    });
    return () => scrollSync.setEditor(null);
  });

  // Preview adapter lifecycle.
  $effect(() => {
    if (!previewContentEl || !previewSyncScrollEl) {
      scrollSync.setPreview(null);
      return;
    }
    const adapter = createPreviewAdapter(previewContentEl, previewSyncScrollEl);
    scrollSync.setPreview(adapter);
    queueMicrotask(() => scrollSync.restoreTo('preview'));
    return () => scrollSync.setPreview(null);
  });

  // After every preview render, refresh anchor cache (positions of each
  // `data-source-line` marker). `MarkdownPreview` also fires this once
  // images finish loading, since heights only stabilise post-load.
  function handlePreviewRender() {
    scrollSync.refresh();
  }

  function handleEditorViewInit(view: EditorView) {
    editorView = view;
  }

  function handleEditorViewDestroy() {
    editorView = null;
  }

  // ── Folder breadcrumb navigation ──────────────────────────────────
  function navigateToNoteFolder() {
    activeSection = 'folders';
    activeFolderId = noteDetailService.folderId as string | null | undefined;
    if (noteDetailService.folderId) {
      getAncestorIds(noteDetailService.folderId, $foldersStore).forEach((id) =>
        expandedIds.add(id)
      );
    }
    activeNoteId.set(null);
  }

  // ── beforeNavigate — flush before SvelteKit navigation ─────────
  beforeNavigate(({ cancel }) => {
    if (noteDetailService.hasPendingChanges()) {
      cancel();
      noteDetailService.flushAndSnapshot().then((ok) => {
        if (!ok) {
          saveErrorDialogOpen = true;
        }
      });
    }
  });

  // ── Mobile + beforeunload + visibilitychange ──────────────────
  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    isMobile = mq.matches;
    mq.addEventListener('change', (e) => {
      isMobile = e.matches;
    });

    // ── Mobile: virtual history guard entry ──────────────────────
    // Creates a "trampoline" entry so that native back gestures trigger
    // popstate instead of exiting the PWA.
    if (mq.matches) {
      history.replaceState({ _rn: 'guard' }, '');
      history.pushState({ _rn: 'app' }, '');
    }

    // Remove old persistent handler if re-mounting (e.g., returning from /settings)
    if ((window as any).__rnPopstateHandler) {
      window.removeEventListener('popstate', (window as any).__rnPopstateHandler);
    }

    let mounted = true;

    function handlePopstate(e: PopStateEvent) {
      if (!window.matchMedia('(max-width: 767px)').matches) return;

      // When component is NOT mounted (e.g., on /settings) and we land
      // on a custom history entry, SvelteKit won't handle it because the
      // state isn't in its format. Force navigation back to app root.
      if (!mounted && e.state?._rn) {
        goto('/', { replaceState: true });
        return;
      }

      // Skip events triggered by resetMobileHistory()'s history.go(-N)
      if (skipPopstateCount > 0) {
        skipPopstateCount--;
        // Re-push the app entry so we stay above the guard
        history.pushState({ _rn: 'app' }, '');
        return;
      }

      if (mobileHistoryDepth > 0) {
        mobileHistoryDepth--;
        navigateUp();
      }

      // Trampoline: if we landed on the guard entry, push a new app entry
      // so the next back gesture doesn't exit the PWA.
      if (e.state?._rn === 'guard') {
        history.pushState({ _rn: 'app' }, '');
      }
    }

    (window as any).__rnPopstateHandler = handlePopstate;
    window.addEventListener('popstate', handlePopstate);

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (noteDetailService.hasPendingChanges()) {
        e.preventDefault();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden' && noteDetailService.hasPendingChanges()) {
        noteDetailService.flushAndSnapshot();
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mounted = false;
      // DON'T remove popstate handler — it must persist for settings→root navigation
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  onDestroy(() => {
    noteDetailService.reset();
    scrollSync.destroy();
  });
</script>

<svelte:head>
  <title>re/notes</title>
</svelte:head>

<svelte:window
  onclick={(e) => {
    if (
      tagManager.colorPickerTagId &&
      !(e.target as HTMLElement)?.closest('[data-tagcolorpicker]')
    ) {
      tagManager.colorPickerTagId = null;
    }
  }}
  onkeydown={(e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      activeSection = 'search';
    }
  }}
/>

{#if isMobile}
  <!-- ══════════════════════════════════════════════════════════════════
     MOBILE: Master-Detail with two full-screen panels
     ══════════════════════════════════════════════════════════════════ -->
  <Tooltip.Provider delayDuration={0}>
    <!-- Mobile root sized to the *visual* viewport (height shrinks when the soft
         keyboard opens), and counter-translated by visualViewport.offsetTop to
         neutralise iOS Safari "page-shift" — so the editor header stays anchored
         to the top of the visible area regardless of caret position. CSS vars are
         emitted in +layout.svelte; fallback `100dvh` covers SSR + browsers
         without visualViewport. -->
    <div
      class="relative overflow-hidden bg-sidebar"
      style="height: var(--rn-vv-height, 100dvh); transform: translateY(var(--rn-vv-offset-top, 0px));"
    >
      <!-- ── Panel 1: Icon Rail + List ──────────────────────────────── -->
      <div
        class="absolute inset-0 flex transition-transform duration-300 ease-in-out"
        class:-translate-x-full={!!$activeNoteId}
      >
        <!-- Icon rail (vertical, always visible) -->
        <IconNav
          bind:activeSection
          onNewNote={handleNewNote}
          onsectionclick={handleSectionClick}
          onPeriodic={handlePeriodic}
          alwaysVisible
        />

        <!-- Content area (list / folder tree / tag list) -->
        <div class="flex flex-1 flex-col min-w-0 overflow-hidden">
          <!-- Header (hidden when NoteList handles its own header) -->
          {#if !(mobileView === 'list' && noteListOwnsMobileHeader)}
            <div class="flex h-14 shrink-0 items-center gap-1 border-b border-sidebar-border px-3">
              {#if mobileView === 'folder-tree' || mobileView === 'tag-list'}
                <button
                  type="button"
                  onclick={handleMobileBack}
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sidebar-foreground
                   hover:bg-sidebar-accent transition-colors"
                  aria-label={$t('nav.back')}
                >
                  <ArrowLeft class="h-5 w-5" />
                </button>
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">
                  {mobileView === 'folder-tree' ? $t('nav.folders') : $t('nav.tags')}
                </span>
                {#if mobileView === 'folder-tree'}
                  <button
                    type="button"
                    onclick={handleNewFolder}
                    title={$t('folders.new_folder')}
                    aria-label={$t('folders.new_folder')}
                    class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sidebar-foreground
                     transition-colors hover:bg-sidebar-accent"
                  >
                    <FolderPlus class="h-5 w-5" />
                  </button>
                {:else}
                  <button
                    type="button"
                    onclick={() => {
                      tagManager.creatingTag = !tagManager.creatingTag;
                      if (tagManager.creatingTag) tagManager.tagSearch = '';
                    }}
                    title={$t('tags.new_tag')}
                    aria-label={$t('tags.new_tag')}
                    class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sidebar-foreground
                     transition-colors hover:bg-sidebar-accent"
                  >
                    <Plus class="h-5 w-5" />
                  </button>
                {/if}
              {:else if activeSection === 'folders' && activeFolderId !== undefined}
                <button
                  type="button"
                  onclick={() => {
                    if (mobileHistoryDepth > 0) {
                      history.back();
                    } else {
                      void exitCurrentFolder();
                    }
                  }}
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sidebar-foreground
                   hover:bg-sidebar-accent transition-colors"
                  aria-label={$t('nav.back')}
                >
                  <ArrowLeft class="h-5 w-5" />
                </button>
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">
                  {activeFolderName}
                </span>
              {:else if activeSection === 'tags' && activeTagId !== null}
                <button
                  type="button"
                  onclick={() => {
                    if (mobileHistoryDepth > 0) {
                      history.back();
                    } else {
                      activeTagId = null;
                      activeNoteId.set(null);
                      mobileView = 'tag-list';
                    }
                  }}
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sidebar-foreground
                   hover:bg-sidebar-accent transition-colors"
                  aria-label={$t('nav.back')}
                >
                  <ArrowLeft class="h-5 w-5" />
                </button>
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">
                  {activeFolderName}
                </span>
              {:else if activeSection === 'all' || activeSection === 'search'}
                <span class="px-2">
                  <img
                    src="{base}/logo-black.svg"
                    alt="re/notes"
                    class="h-5 w-auto block dark:hidden"
                  />
                  <img
                    src="{base}/logo-white.svg"
                    alt="re/notes"
                    class="h-5 w-auto hidden dark:block dark:opacity-80"
                  />
                </span>
              {/if}
            </div>
          {/if}

          <!-- Content -->
          <div class="flex-1 overflow-hidden">
            {#if mobileView === 'folder-tree'}
              <div class="flex flex-col overflow-hidden h-full">
                <div class="flex-1 overflow-y-auto px-2 py-2">
                  {#if $foldersStore.length === 0}
                    <p class="px-2 py-1 text-xs text-muted-foreground">
                      {$t('folders.no_folders_short')}
                    </p>
                  {:else}
                    <FolderTree
                      nodes={$foldersStore}
                      activeFolderId={activeFolderId ?? null}
                      {expandedIds}
                      onselect={handleFolderSelect}
                    />
                  {/if}
                </div>
              </div>
            {:else if mobileView === 'tag-list'}
              <TagListMobile {activeTagId} onselect={handleTagSelect} bind:mobileNewTagInput />
            {:else}
              <NoteList
                {activeFolderName}
                {activeSection}
                activeFolderId={activeFolderId ?? null}
                isTrash={activeTrash}
                isPeriodic={isPeriodicSection(activeSection)}
                subfolders={activeFolderSubfolders}
                onSubfolderSelect={handleFolderSelect}
                autoFocusSearch={activeSection === 'search'}
                searchOnly={activeSection === 'search'}
                prominentHeader={noteListOwnsMobileHeader}
                onback={activeSection === 'folders' && activeFolderId !== undefined
                  ? () => {
                      if (isMobile && mobileHistoryDepth > 0) {
                        history.back();
                      } else {
                        void exitCurrentFolder();
                      }
                    }
                  : activeSection === 'tags' && activeTagId !== null
                    ? () => {
                        if (isMobile && mobileHistoryDepth > 0) {
                          history.back();
                        } else {
                          activeTagId = null;
                          activeNoteId.set(null);
                          mobileView = 'tag-list';
                        }
                      }
                    : undefined}
                oncreate={handleNewNote}
              />
            {/if}
          </div>

          <SyncStatusFooter />
        </div>
      </div>

      <!-- ── Panel 2: Note Editor ───────────────────────────────────── -->
      <div
        class="absolute inset-0 flex flex-col bg-background transition-transform duration-300 ease-in-out"
        class:translate-x-full={!$activeNoteId}
        ontouchstart={handleSwipeStart}
        ontouchend={handleSwipeEnd}
        role="region"
        aria-label="Note editor"
      >
        {#if $activeNoteId}
          {#if historyMode === 'diff' && selectedVersion}
            <HistoryHeader
              {isMobile}
              {selectedVersion}
              {previousVersion}
              {isLatestVersion}
              bind:historyViewMode
              onback={() => {
                if (isMobile && mobileHistoryDepth > 0) {
                  history.back();
                } else {
                  activeNoteId.set(null);
                }
              }}
              onclose={closeHistory}
              onrestore={() => {
                restoreDialogOpen = true;
              }}
              onshowlist={() => {
                historyMode = 'list';
              }}
            />

            <NoteContentArea
              noteId={$activeNoteId}
              {effectiveViewMode}
              bind:showEncryptionXRay
              {historyMode}
              {historyViewMode}
              {selectedVersion}
              {previousVersion}
              bind:editorRef
              bind:previewScrollEl
              bind:previewContentEl
              {autocompleteNotes}
              oncontentchange={handleContentChange}
              onviewinit={handleEditorViewInit}
              onviewdestroy={handleEditorViewDestroy}
              onpreviewrender={handlePreviewRender}
              onnotelinkrequest={openNotePicker}
              onnotelink={handleNoteLink}
              {resolveNoteTitle}
              imageLoadMode={$imageLoadMode}
              noteKind={currentNoteKind}
            />
          {:else}
            <NoteEditorHeader
              {isMobile}
              {activeTrash}
              bind:viewMode
              {effectiveViewMode}
              bind:historyMode
              onback={() => {
                if (isMobile && mobileHistoryDepth > 0) {
                  history.back();
                } else {
                  activeNoteId.set(null);
                }
              }}
              onshowxray={() => {
                showEncryptionXRay = true;
              }}
              onrestore={async () => {
                await notesStore.restore($activeNoteId!);
                activeNoteId.set(null);
              }}
              onpermanentdelete={() => {
                permanentDeleteDialogOpen = true;
              }}
              onhistoryreset={resetHistoryState}
              title={noteDetailService.title}
              showTitle={!mobileTitleVisible}
            >
              {#snippet actions()}
                <NoteDetailActions
                  note={detailMenuNote}
                  onmenuopen={() => (detailActionSheetOpen = true)}
                  onpin={handleDetailPin}
                  onstar={handleDetailStar}
                  onmove={handleDetailMoveDesktop}
                  onexport={() => handleDetailExport()}
                  onexportpdf={() => handleDetailExportPdf()}
                  oncopylink={() => handleDetailCopyLink()}
                  onshowxray={() => { showEncryptionXRay = true; }}
                  ondelete={handleDetailDelete}
                />
              {/snippet}
            </NoteEditorHeader>

            <!-- Scrollable: metadata + content scroll away -->
            <div bind:this={mobileScrollContainer} class="flex flex-1 flex-col overflow-y-auto">
              <div bind:this={mobileTitleSentinel} class="h-0 w-0 shrink-0"></div>

              <NoteMetadataBar
                {isMobile}
                {activeTrash}
                title={noteDetailService.title}
                folderName={activeNoteFolderName}
                noteId={$activeNoteId}
                updatedAt={detailMenuNote?.updated_at ?? null}
                createdAt={detailMenuNote?.created_at ?? null}
                ontitleinput={handleTitleInput}
                onfolderclick={navigateToNoteFolder}
              />

              <NoteContentArea
                noteId={$activeNoteId}
                {effectiveViewMode}
                bind:showEncryptionXRay
                {historyMode}
                {historyViewMode}
                {selectedVersion}
                {previousVersion}
                bind:editorRef
                bind:previewScrollEl
                bind:previewContentEl
                {autocompleteNotes}
                {isMobile}
                parentScroll={true}
                oncontentchange={handleContentChange}
                onviewinit={handleEditorViewInit}
                onviewdestroy={handleEditorViewDestroy}
                onpreviewrender={handlePreviewRender}
                onnotelinkrequest={openNotePicker}
                onnotelink={handleNoteLink}
                {resolveNoteTitle}
                imageLoadMode={$imageLoadMode}
                noteKind={currentNoteKind}
              />
            </div>
          {/if}
        {:else if $isInitialSync}
          <InitialSyncState compact />
        {:else}
          <div class="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <p class="text-sm">{$t('notes.select_or_create')}</p>
          </div>
        {/if}
      </div>
    </div>
  </Tooltip.Provider>
{:else}
  <!-- ══════════════════════════════════════════════════════════════════
     DESKTOP: Original 3-column layout
     ══════════════════════════════════════════════════════════════════ -->
  <!-- height tracks visualViewport so the soft keyboard (iPad PWA Safari etc.)
       shrinks the desktop scroll container instead of leaving the bottom of
       the note hidden behind the keyboard. CSS var emitted in +layout.svelte;
       fallback `100vh` covers SSR + browsers without visualViewport. -->
  <SidebarProvider style="height: var(--rn-vv-height, 100vh); min-height: 0; overflow: hidden; --sidebar-width: 24rem;">
    <Sidebar
      variant="inset"
      collapsible="offcanvas"
      class="overflow-hidden [&>[data-sidebar=sidebar]]:flex-row"
    >
      <SidebarAutoClose {closeSidebarSignal} />

      <!-- ── Icon rail (desktop only) ────────────────────────────── -->
      <IconNav
        bind:activeSection
        onNewNote={handleNewNote}
        onsectionclick={handleSectionClick}
        onPeriodic={handlePeriodic}
      />

      <!-- ── Content panel ───────────────────────────────────────── -->
      <div class="flex flex-1 flex-col min-w-0 overflow-hidden">
        <SidebarHeader class="border-b p-0 gap-0">
          <div class="flex h-12 items-center gap-2 px-5">
            <img src="{base}/logo-black.svg" alt="re/notes" class="h-4 w-auto block dark:hidden" />
            <img
              src="{base}/logo-white.svg"
              alt="re/notes"
              class="h-4 w-auto hidden dark:block dark:opacity-80"
            />
          </div>
        </SidebarHeader>

        <SidebarContent class="p-0 gap-0">
          {#if activeSection === 'folders'}
            <div class="flex flex-col overflow-hidden h-full">
              <div class="flex h-10 shrink-0 items-center gap-1 px-5">
                <span class="min-w-0 flex-1 truncate text-sm font-normal">{$t('nav.folders')}</span>
                <button
                  type="button"
                  onclick={handleNewFolder}
                  title={$t('folders.new_folder')}
                  aria-label={$t('folders.new_folder')}
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground
                         transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <FolderPlus class="h-4 w-4" />
                </button>
              </div>
              <div class="mx-3 border-t"></div>
              <div class="flex-1 overflow-y-auto px-2 py-2">
                {#if $foldersStore.length === 0}
                  <p class="px-2 py-4 text-center text-xs text-muted-foreground">
                    {$t('folders.no_folders_short')}
                  </p>
                {:else}
                  <FolderTree
                    nodes={$foldersStore}
                    activeFolderId={activeFolderId ?? null}
                    {expandedIds}
                    onselect={handleFolderSelect}
                  />
                {/if}
              </div>
            </div>
          {:else if activeSection === 'tags'}
            <TagSidebarSection
              {activeTagId}
              onselect={handleTagSelect}
              ondelete={(tagId) => tagManager.handleDeleteTag(tagId)}
            />
          {:else if activeSection === 'search'}
            <NoteList
              {activeFolderName}
              {activeSection}
              isTrash={false}
              isPeriodic={false}
              autoFocusSearch
              searchOnly
              oncreate={handleNewNote}
            />
          {:else}
            <NoteList
              {activeFolderName}
              {activeSection}
              isTrash={activeTrash}
              isPeriodic={isPeriodicSection(activeSection)}
              oncreate={handleNewNote}
            />
          {/if}
        </SidebarContent>
        <SyncStatusFooter />
      </div>
    </Sidebar>

    <!-- ── Column 3: Main content area ─────────────────────────────── -->
    <SidebarInset class="overflow-hidden flex flex-col min-w-0 bg-background">
      {#if $activeNoteId}
        {#if historyMode === 'diff' && selectedVersion}
          <HistoryHeader
            {isMobile}
            {selectedVersion}
            {previousVersion}
            {isLatestVersion}
            bind:historyViewMode
            onclose={closeHistory}
            onrestore={() => {
              restoreDialogOpen = true;
            }}
            onshowlist={() => {
              historyMode = 'list';
            }}
          />

          <NoteContentArea
            noteId={$activeNoteId}
            {effectiveViewMode}
            bind:showEncryptionXRay
            {historyMode}
            {historyViewMode}
            {selectedVersion}
            {previousVersion}
            bind:editorRef
            bind:previewScrollEl
            bind:previewContentEl
            {autocompleteNotes}
            oncontentchange={handleContentChange}
            onviewinit={handleEditorViewInit}
            onviewdestroy={handleEditorViewDestroy}
            onpreviewrender={handlePreviewRender}
            onnotelinkrequest={openNotePicker}
            onnotelink={handleNoteLink}
            {resolveNoteTitle}
            imageLoadMode={$imageLoadMode}
            noteKind={currentNoteKind}
          />
        {:else}
          <NoteEditorHeader
            {isMobile}
            {activeTrash}
            bind:viewMode
            {effectiveViewMode}
            bind:historyMode
            onback={() => activeNoteId.set(null)}
            onshowxray={() => {
              showEncryptionXRay = true;
            }}
            onrestore={async () => {
              await notesStore.restore($activeNoteId!);
              activeNoteId.set(null);
            }}
            onpermanentdelete={() => {
              permanentDeleteDialogOpen = true;
            }}
            onhistoryreset={resetHistoryState}
            title={noteDetailService.title}
            showTitle={!desktopTitleVisible}
          >
            {#snippet actions()}
              <NoteDetailActions
                note={detailMenuNote}
                onmenuopen={() => (detailActionSheetOpen = true)}
                onpin={handleDetailPin}
                onstar={handleDetailStar}
                onmove={handleDetailMoveDesktop}
                onexport={() => handleDetailExport()}
                onexportpdf={() => handleDetailExportPdf()}
                oncopylink={() => handleDetailCopyLink()}
                onshowxray={() => { showEncryptionXRay = true; }}
                ondelete={handleDetailDelete}
              />
            {/snippet}
          </NoteEditorHeader>

          <!-- Scrollable area: metadata + toolbar + editor scroll together -->
          <div
            bind:this={desktopEditorScrollContainer}
            class="flex flex-1 flex-col min-h-0 overflow-y-auto"
          >
            <div bind:this={desktopTitleSentinel} class="h-0 w-0 shrink-0"></div>

            <NoteMetadataBar
              {isMobile}
              {activeTrash}
              title={noteDetailService.title}
              folderName={activeNoteFolderName}
              noteId={$activeNoteId}
              updatedAt={detailMenuNote?.updated_at ?? null}
              createdAt={detailMenuNote?.created_at ?? null}
              {effectiveViewMode}
              ontitleinput={handleTitleInput}
              onfolderclick={navigateToNoteFolder}
            />

            <NoteContentArea
              noteId={$activeNoteId}
              {effectiveViewMode}
              bind:showEncryptionXRay
              {historyMode}
              {historyViewMode}
              {selectedVersion}
              {previousVersion}
              bind:editorRef
              bind:previewScrollEl
              bind:previewContentEl
              {autocompleteNotes}
              parentScroll={true}
              oncontentchange={handleContentChange}
              onviewinit={handleEditorViewInit}
              onviewdestroy={handleEditorViewDestroy}
              onpreviewrender={handlePreviewRender}
              onnotelinkrequest={openNotePicker}
              onnotelink={handleNoteLink}
              {resolveNoteTitle}
              imageLoadMode={$imageLoadMode}
              noteKind={currentNoteKind}
            />
          </div>
        {/if}
      {:else if showNoteListInMain}
        <div class="mx-auto h-full w-full max-w-4xl px-6 pt-6 flex flex-col">
          <NoteList
            {activeFolderName}
            {activeSection}
            activeFolderId={activeFolderId ?? null}
            isTrash={false}
            isPeriodic={isPeriodicSection(activeSection)}
            showSidebarTrigger
            subfolders={activeFolderSubfolders}
            onSubfolderSelect={handleFolderSelect}
            onback={activeFolderParentId ? handleFolderBack : undefined}
            oncreate={handleNewNote}
          />
        </div>
      {:else}
        <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-6">
          <SidebarTrigger class="md:hidden -ml-1 shrink-0" />
          <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {activeFolderName}
          </span>
          <span
            class="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/50
                 px-2 py-0.5 text-xs text-muted-foreground select-none"
            title={$t('e2e.badge_tooltip')}
          >
            <Lock class="h-3 w-3" />
            <span class="hidden lg:inline">{$t('e2e.badge')}</span><span class="lg:hidden"
              >{$t('e2e.badge_short')}</span
            >
          </span>
        </header>
        {#if $isInitialSync}
          <InitialSyncState />
        {:else}
          <div class="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <div class="flex flex-col items-center gap-1 text-center">
              <p class="text-sm">{$t('notes.select_or_create')}</p>
              <p class="text-xs opacity-60">{$t('notes.e2e_info')}</p>
            </div>
          </div>
        {/if}
      {/if}
    </SidebarInset>
  </SidebarProvider>
{/if}

<ConfirmDialog
  bind:open={permanentDeleteDialogOpen}
  title={$t('notes.perm_delete_title')}
  description={$t('notes.perm_delete_desc')}
  confirmText={$t('notes.perm_delete_confirm')}
  destructive
  onConfirm={async () => {
    await notesStore.permanentDelete($activeNoteId!);
    activeNoteId.set(null);
  }}
/>

<ConfirmDialog
  bind:open={saveErrorDialogOpen}
  title={$t('save_status.error_title')}
  description={$t('save_status.error_desc')}
  confirmText={$t('save_status.discard')}
  cancelText={$t('save_status.keep_editing')}
  destructive
  onConfirm={() => {
    noteDetailService.reset();
    if (pendingNavigationAction) {
      pendingNavigationAction();
      pendingNavigationAction = null;
    }
  }}
  onCancel={() => {
    pendingNavigationAction = null;
  }}
/>

<ConfirmDialog
  bind:open={tagManager.deleteTagDialogOpen}
  title={$t('folders.delete_tag_title')}
  description={$t('folders.delete_tag_desc')}
  confirmText={$t('tags.delete_tag')}
  destructive
  onConfirm={() =>
    tagManager.confirmDeleteTag(activeTagId, () => {
      activeTagId = null;
    })}
/>

<NotePicker
  bind:open={notePickerOpen}
  notes={notePickerNotes}
  excludeNoteId={$activeNoteId}
  onselect={handleNotePickerSelect}
/>

{#if $activeNoteId}
  {@const historySheetOpen = historyMode === 'list'}
  <VersionHistorySheet
    noteId={$activeNoteId}
    open={historySheetOpen}
    onselect={(version, prevVersion, isLatest) => {
      selectedVersion = version;
      previousVersion = prevVersion;
      isLatestVersion = isLatest;
      historyMode = 'diff';
    }}
    onclose={() => {
      if (selectedVersion) {
        historyMode = 'diff';
      } else {
        historyMode = 'closed';
        historyViewMode = 'preview';
      }
    }}
  />
{/if}

<ConfirmDialog
  bind:open={restoreDialogOpen}
  title={$t('history.restore_title')}
  description={$t('history.restore_desc')}
  confirmText={$t('history.restore_version')}
  onConfirm={async () => {
    if (selectedVersion) {
      await handleRestoreVersion(selectedVersion.title, selectedVersion.content);
      closeHistory();
    }
  }}
/>

<TagActionSheet ondelete={(tagId) => tagManager.handleDeleteTag(tagId)} />

<!-- Detail-view action menu (mobile bottom sheet) -->
<NoteActionSheet
  bind:open={detailActionSheetOpen}
  note={detailMenuNote}
  onpin={() => handleDetailPin()}
  onstar={() => handleDetailStar()}
  onmove={() => handleDetailOpenMoveMobile()}
  onexport={(note) => handleDetailExport(note)}
  onexportpdf={(note) => handleDetailExportPdf(note)}
  oncopylink={(note) => handleDetailCopyLink(note)}
  ondelete={() => handleDetailDelete()}
  onhistory={handleDetailHistory}
  onshowxray={() => { showEncryptionXRay = true; }}
  onrestore={() => {}}
  onpermanentdelete={() => {}}
/>

<!-- Detail-view move-to-folder (mobile bottom sheet) -->
{#if isMobile}
  <MoveToFolderMenu
    noteId={detailMovingNoteId}
    bind:open={detailMoveSheetOpen}
    onmove={handleDetailMoveMobile}
  />
{/if}

<ConfirmDialog
  bind:open={detailDeleteDialogOpen}
  title={$t('notes.delete_title')}
  description={$t('notes.delete_desc')}
  confirmText={$t('notes.delete_note')}
  destructive
  onConfirm={confirmDetailDelete}
/>

<EditorModeIntroDialog
  bind:open={editorModeIntroOpen}
  onclose={handleEditorModeIntroClose}
/>

<PeriodicNoteOnboardingDialog
  kind={periodicOnboardingKind}
  onclose={handlePeriodicOnboardingClose}
/>
