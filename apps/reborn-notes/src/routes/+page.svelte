<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { beforeNavigate } from '$app/navigation';
  import { base } from '$app/paths';
  import { copyText } from '$lib/utils/clipboard';
  import { SvelteSet, SvelteMap } from 'svelte/reactivity';
  import { FolderPlus, Plus, ArrowLeft, Lock, ListTree, PinOff, Share2 } from '@lucide/svelte';

  // Layout
  import IconNav, { type Section, isPeriodicSection } from '$lib/components/layout/IconNav.svelte';
  import SidebarAutoClose from '$lib/components/layout/SidebarAutoClose.svelte';
  import SyncStatusFooter from '$lib/components/sync/SyncStatusFooter.svelte';
  import InitialSyncState from '$lib/components/sync/InitialSyncState.svelte';
  import { isInitialSync } from '$lib/stores/sync-status.store';
  import { platform } from '$lib/platform';
  import { SidebarProvider, SidebarHeader, SidebarContent } from '@reborn/ui/sidebar';
  import * as Tooltip from '@reborn/ui/components/tooltip';

  // Content components
  import NoteList from '$lib/components/NoteList.svelte';
  import NotePicker from '$lib/components/NotePicker.svelte';

  import VersionHistorySheet from '$lib/components/VersionHistorySheet.svelte';
  import LinkedNotesSheet from '$lib/components/LinkedNotesSheet.svelte';
  import OutlineSheet from '$lib/components/OutlineSheet.svelte';
  import OutlineTree from '$lib/components/OutlineTree.svelte';
  import FolderTree from '$lib/components/sidebar/FolderTree.svelte';
  import { pendingNewFolderDraft } from '$lib/stores/new-folder-draft.store';
  import ConfirmDialog from '$lib/components/shared/ConfirmDialog.svelte';
  import AccountRequiredDialog from '$lib/components/shared/AccountRequiredDialog.svelte';
  import { authStore } from '$lib/stores/auth.store';
  import NoteEditor from '$lib/components/NoteEditor.svelte';

  // Extracted components
  import NoteEditorHeader from '$lib/components/editor/NoteEditorHeader.svelte';
  import HistoryHeader from '$lib/components/editor/HistoryHeader.svelte';
  import NoteContentArea from '$lib/components/editor/NoteContentArea.svelte';
  import EncryptionXRay from '$lib/components/EncryptionXRay.svelte';
  import NoteDetailActions from '$lib/components/editor/NoteDetailActions.svelte';
  import NoteSearchBar from '$lib/components/editor/NoteSearchBar.svelte';
  import NoteMetadataBar from '$lib/components/editor/NoteMetadataBar.svelte';
  import NoteActionSheet from '$lib/components/notes/NoteActionSheet.svelte';
  import ShareNoteDialog from '$lib/components/notes/ShareNoteDialog.svelte';
  import MoveToFolderMenu from '$lib/components/notes/MoveToFolderMenu.svelte';
  import TagSidebarSection from '$lib/components/tags/TagSidebarSection.svelte';
  import TagListMobile from '$lib/components/tags/TagListMobile.svelte';
  import TagActionSheet from '$lib/components/tags/TagActionSheet.svelte';
  import SharesList from '$lib/components/shares/SharesList.svelte';
  import ShareDetailPanel from '$lib/components/shares/ShareDetailPanel.svelte';

  // Stores / services
  import { notesStore, activeNoteId, type NoteListItem } from '$lib/stores/notes.store';
  import { sharesStore, activeShareId } from '$lib/stores/shares.store';
  import * as NoteService from '$lib/services/note.service';
  import { exportNoteAsMarkdown, exportNoteAsPdf } from '$lib/services/export-import.service';
  import * as PeriodicNotesService from '$lib/services/periodic-notes.service';
  import type { PeriodicKind } from '@reborn/storage';
  import { foldersStore } from '$lib/stores/folders.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { savedSearchesStore } from '$lib/stores/saved-searches.store';
  import type { SavedSearchDecrypted } from '@reborn/types';
  import { getSettings } from '$lib/utils/app-settings';
  import {
    appSettings,
    imageLoadMode,
    editorModeOverride,
    effectiveEditorMode,
    editorModeIntroSeen,
    periodicNotesSettings,
    confirmBeforeDelete
  } from '$lib/stores/app-settings.store';
  import {
    devicePrefs,
    noteOpenMode,
    noteListCollapsed,
    tocPinned
  } from '$lib/stores/device-prefs.store';
  import EditorModeIntroDialog from '$lib/components/editor/EditorModeIntroDialog.svelte';
  import PeriodicNoteOnboardingDialog from '$lib/components/editor/PeriodicNoteOnboardingDialog.svelte';
  import type { EditorMode } from '@reborn/storage';
  import { t } from '$lib/stores/i18n.store';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import { noteIndex } from '$lib/services/note-index.svelte';
  import { noteNavHistory } from '$lib/services/note-nav-history.svelte';
  import { tagManager } from '$lib/services/tag-manager.svelte';
  import { toastStore } from '@reborn/ui';
  import {
    flattenFolderTree,
    getAncestorIds,
    findChildrenOfParent,
    buildBreadcrumb
  } from '$lib/utils/folder-helpers';
  import type { SaveScope } from '$lib/utils/search-scope';
  import { goto } from '$lib/utils/navigation';
  import { createScrollSync } from '$lib/utils/scroll-sync';
  import { scrollToHeading } from '$lib/utils/heading-scroll';
  import { extractHeadings, type DocHeading } from '$lib/utils/heading-outline';
  import { applyToc, removeToc, hasToc, isTocStale, tocHiddenSpans } from '$lib/utils/toc';
  import { createEditorAdapter, createPreviewAdapter } from '$lib/utils/line-adapter';
  import { requireActiveSession } from '$lib/utils/require-active-session';
  import type { EditorView } from '@codemirror/view';
  import {
    findMatches,
    excludeMatchesInSpans,
    NOTE_SEARCH_MATCH_CAP,
    type SearchMatch
  } from '$lib/utils/note-search-core';
  import { setNoteSearch, scrollCmMatchIntoView } from '$lib/editor/note-search';
  import {
    findDomMatchRanges,
    paintDomHighlights,
    clearDomHighlights,
    scrollDomRangeIntoView
  } from '$lib/utils/note-search-dom';

  type ViewMode = 'edit' | 'split' | 'preview';

  // ── Section / nav state ──────────────────────────────────────────
  let activeSection = $state<Section>('all');
  let activeFolderId = $state<string | null | undefined>(undefined);
  let activeTagId = $state<string | null>(null);
  // Active smart folder: a pinned saved search opened in the main list (NOT the
  // Search section). Lives alongside activeFolderId under the 'folders' section -
  // when set, activeFolderId is undefined and the list's membership filter is the
  // saved query (notesStore.setSmartFolder, driven by the section effect below).
  // Derived from the store by id so renaming the open search reflows the header;
  // the guard effect drops it if the search is deleted while open.
  let activeSavedSearchId = $state<string | null>(null);
  const activeSavedSearch = $derived(
    activeSavedSearchId !== null
      ? ($savedSearchesStore.find((s) => s.id === activeSavedSearchId) ?? null)
      : null
  );
  // Last folder the user visited — used to scroll the folder tree back to that
  // node after exiting all the way up to the tree root, so deep trees keep context.
  let lastVisitedFolderId = $state<string | null>(null);
  const activeStarred = $derived(activeSection === 'starred');
  const activeTrash = $derived(activeSection === 'trash');

  // The note-list collapse is a focus affordance for an OPEN note. With no note
  // in the main pane (e.g. right after clicking a rail section, which clears
  // activeNoteId), a collapsed list would leave an empty pane - so the panel
  // always returns when no note is open. The collapse toggle lives in the note
  // header (present only with a note open), not the always-visible rail.
  const panelCollapsedEffective = $derived($noteListCollapsed && $activeNoteId != null);
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

  // Prefer the filtered sidebar row (same live data, already in scope), but fall
  // back to the full index: a note opened via a [[link]] or the Back/Forward
  // trail lands outside the active search/folder filter and is absent from
  // $notesStore. Without this fallback its kebab action menu and created/updated
  // metadata silently vanish (detailMenuNote → null).
  const detailMenuNote = $derived.by((): NoteListItem | null => {
    const id = $activeNoteId;
    if (!id) return null;
    return $notesStore.find((n) => n.id === id) ?? noteIndex.getItem(id);
  });

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
  // Periodic kind whose button is mid-resolve (waiting on the initial-sync
  // pull). Drives the spinner on the IconNav button so a click doesn't look
  // dead while getOrCreateNote awaits the pull. Null in steady state.
  let periodicPendingKind = $state<PeriodicKind | null>(null);

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

  async function handleDetailMoveMobile(folderId: string | null, e?: Event) {
    e?.stopPropagation();
    const noteId = detailMovingNoteId;
    detailMoveSheetOpen = false;
    detailMovingNoteId = null;
    if (!noteId) return;
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
    try {
      await exportNoteAsMarkdown(fullNote, tagNames);
    } catch {
      toastStore.error($t('notes.export_failed'));
    }
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
    if (await copyText(link)) {
      toastStore.success($t('notes.note_link_copied'));
    } else {
      toastStore.error('Failed to copy');
    }
  }

  // ── Read-only share dialog state ───────────────────────────────
  let shareDialogOpen = $state(false);
  let shareNoteId = $state<string | null>(null);
  let shareNoteTitle = $state<string>('');
  // Local-only mode: sharing needs a server account - nudge to register instead.
  let accountRequiredOpen = $state(false);

  async function handleDetailShare(noteArg?: NoteListItem) {
    detailActionSheetOpen = false;
    const target = noteArg ?? detailMenuNote;
    if (!target) return;
    if ($authStore.isLocalOnly) {
      accountRequiredOpen = true;
      return;
    }
    const ok = await requireActiveSession({
      description: $t('share.session_required.create')
    });
    if (!ok) return;
    shareNoteId = target.id;
    shareNoteTitle = target.title ?? '';
    shareDialogOpen = true;
  }

  function handleDetailDelete() {
    detailActionSheetOpen = false;
    // When confirmation is disabled (#350), delete straight to Trash (recoverable).
    if (!$confirmBeforeDelete) {
      confirmDetailDelete();
      return;
    }
    detailDeleteDialogOpen = true;
  }

  function handleDetailHistory() {
    detailActionSheetOpen = false;
    historyMode = historyMode === 'closed' ? 'list' : 'closed';
    if (historyMode === 'closed') {
      resetHistoryState();
    }
  }

  function toggleLinkedNotes() {
    linkedNotesOpen = !linkedNotesOpen;
    if (linkedNotesOpen) {
      outlineOpen = false;
      if (historyMode !== 'closed') closeHistory();
    }
  }

  function handleDetailLinkedNotes() {
    detailActionSheetOpen = false;
    if (historyMode !== 'closed') closeHistory();
    outlineOpen = false;
    linkedNotesOpen = true;
  }

  function toggleOutline() {
    // When the outline is docked (desktop, pinned, has headings) the header
    // toggle unpins it - a docked panel has no transient per-note "hide".
    if (tocDocked) {
      devicePrefs.setTocPinned(false);
      return;
    }
    outlineOpen = !outlineOpen;
    if (outlineOpen) {
      linkedNotesOpen = false;
      if (historyMode !== 'closed') closeHistory();
    }
  }

  // Dock the outline beside the editor (from the floating drawer's Pin button).
  // Global, per-device; hands the drawer off to the dock.
  function pinOutline() {
    devicePrefs.setTocPinned(true);
    outlineOpen = false;
  }

  // Undock (from the docked panel). The outline is fully hidden; the header
  // button reopens it as a floating drawer.
  function unpinOutline() {
    devicePrefs.setTocPinned(false);
  }

  function handleDetailOutline() {
    detailActionSheetOpen = false;
    if (historyMode !== 'closed') closeHistory();
    linkedNotesOpen = false;
    outlineOpen = true;
  }

  // Jump to a heading from the Outline panel. In a preview-bearing view we scroll
  // the rendered preview by slug; in edit-only mode there is no preview, so we
  // scroll the CodeMirror editor to the heading's source line instead.
  function handleOutlineNavigate(heading: DocHeading) {
    // Mark the clicked entry active immediately - it's an explicit choice, and at
    // the end of a note the preview often can't scroll it under the trigger zone,
    // so scroll position alone would leave the wrong (or the last) entry marked.
    // Lock it against the scroll-spy for the duration of the programmatic scroll
    // (released once motion settles), so it isn't overwritten mid-scroll; then a
    // real user scroll resumes the spy. The slug equals the rendered heading's id,
    // matching the spy's own value and OutlineSheet's `node.slug === activeSlug`.
    activeOutlineSlug = heading.slug;
    outlineNavLocked = true;
    scheduleOutlineNavUnlock();

    if (effectiveViewMode === 'edit') {
      editorRef?.scrollToLine(heading.line);
    } else {
      scrollToHeading(previewContentEl, heading.slug);
    }
    if (isMobile) outlineOpen = false;
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
  // The editing view (edit/split) the user was last in, so Mod+E can restore it
  // when toggling back from preview instead of always landing on plain edit.
  let lastEditViewMode: 'edit' | 'split' = 'edit';
  type HistoryMode = 'closed' | 'list' | 'diff';
  let historyMode = $state<HistoryMode>('closed');
  let linkedNotesOpen = $state(false);
  let outlineOpen = $state(false);

  // The Linked notes / Outline panels are mutually exclusive with version
  // history and with each other (all right-side sheets), and reset when
  // returning to the list, so opening another note never auto-reopens them.
  $effect(() => {
    if (historyMode !== 'closed' || $activeNoteId == null) {
      linkedNotesOpen = false;
      outlineOpen = false;
    }
  });
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

  // ── Outline (TOC) presentation ──────────────────────────────────
  // Desktop + pinned (global, per-device) docks the outline beside the editor,
  // but only for notes that actually have headings (else the dock auto-hides).
  // Otherwise the outline is the transient floating drawer toggled by the header
  // button. `outlineOpen` drives ONLY the floating drawer; the dock is derived.
  const tocDocked = $derived.by(() => {
    if (
      isMobile ||
      !$tocPinned ||
      $activeNoteId == null ||
      historyMode !== 'closed' ||
      linkedNotesOpen
    )
      return false;
    return extractHeadings(noteDetailService.content).length > 0;
  });
  const tocFloating = $derived(outlineOpen && !tocDocked);
  // Outline visible in any form - drives the header toggle's pressed state and
  // gates the scroll-spy.
  const outlineVisible = $derived(tocDocked || tocFloating);

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

  /** Close the Shares detail pane, going through the mobile history stack so the
   *  hardware back / swipe stays in sync (desktop just clears the selection). */
  function closeShareDetail() {
    if (isMobile && mobileHistoryDepth > 0) {
      history.back();
    } else {
      activeShareId.set(null);
    }
  }

  /** Navigate one level up based on current app state. Called by popstate handler. */
  function navigateUp() {
    if (activeSection === 'shares' && $activeShareId != null) {
      activeShareId.set(null);
    } else if ($activeNoteId != null) {
      noteDetailService.flushAndSnapshot();
      activeNoteId.set(null);
    } else if (mobileView === 'list' && activeSection === 'folders' && activeFolderId !== undefined) {
      void exitCurrentFolder();
    } else if (mobileView === 'list' && activeSection === 'folders' && activeSavedSearchId !== null) {
      exitSmartFolder();
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
      // Walk the note visit trail first (C→B→A); only once it's exhausted does
      // the swipe fall through to closing the note / popping the mobile history.
      if ($activeNoteId != null && noteNavHistory.canGoBack) {
        goBackNote();
      } else if (isMobile && mobileHistoryDepth > 0) {
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

  // ── Mobile: push history when the share detail opens ───────────
  let prevShareIdForHistory: string | null = null;
  $effect(() => {
    const id = $activeShareId;
    if (isMobile && id != null && prevShareIdForHistory == null) {
      pushMobileHistory();
    }
    prevShareIdForHistory = id;
  });

  // ── Derived: should main area show note list? ──────────────────
  const showNoteListInMain = $derived(
    (activeSection === 'folders' && activeFolderId !== undefined) ||
      (activeSection === 'folders' && activeSavedSearchId !== null) ||
      (activeSection === 'tags' && activeTagId !== null)
  );

  // Mobile detail pane (Panel 2) slides in for an open note OR a selected share.
  const mobileDetailOpen = $derived(
    $activeNoteId != null || (activeSection === 'shares' && $activeShareId != null)
  );

  /** Mobile-only: sections where NoteList renders its own prominent (h-12) header,
   *  so the master mobile wrapper header should be skipped. Includes drill-down
   *  folder/tag selections and any flat-list view (starred, trash, periodic). */
  const noteListOwnsMobileHeader = $derived(
    activeSection === 'starred' ||
      activeSection === 'trash' ||
      activeSection === 'shares' ||
      isPeriodicSection(activeSection) ||
      (activeSection === 'folders' && activeFolderId !== undefined) ||
      (activeSection === 'folders' && activeSavedSearchId !== null) ||
      (activeSection === 'tags' && activeTagId !== null)
  );

  // ── Derived labels ───────────────────────────────────────────────
  const activeFolderName = $derived.by(() => {
    if (activeSection === 'search') return $t('nav.search');
    // Smart folder: header shows the saved search's name (falls back if the
    // search vanished mid-render, before the guard effect clears the id).
    if (activeSection === 'folders' && activeSavedSearchId !== null) {
      return activeSavedSearch?.name ?? $t('nav.folders');
    }
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
  // Cross-section "open this note" request. A handler sets this id right before
  // switching to a (non-periodic) destination section; the section-sync effect
  // below adopts it after its flush instead of clearing activeNoteId. The
  // non-periodic analogue of how handlePeriodic lets periodic sections keep their
  // freshly-opened note. Currently armed by "Open source note" from a share.
  let pendingOpenNoteId: string | null = null;

  /**
   * #384: entering the Folders section on desktop should land on a folder, not
   * an empty pane. Prefer the last folder visited this session; if it was since
   * deleted (or there is none yet), fall back to the first top-level folder;
   * with no folders at all, stay unscoped (undefined) so the create/empty state
   * shows. Session-scoped by design - it rides on `lastVisitedFolderId`, which
   * is ephemeral and resets on reload.
   */
  function resolveFoldersEntryFolderId(): string | undefined {
    if (
      lastVisitedFolderId &&
      flattenFolderTree($foldersStore).some((f) => f.id === lastVisitedFolderId)
    ) {
      return lastVisitedFolderId;
    }
    return $foldersStore[0]?.id;
  }

  $effect(() => {
    const section = activeSection;
    const sectionUsesFolderId = section === 'folders' || isPeriodicSection(section);
    const tagId = activeSection === 'tags' ? activeTagId : null;
    // Only the Folders section hosts smart folders. Tracked here so opening one
    // (activeSavedSearchId set by handleSavedSearchSelect) re-runs this effect.
    const savedSearchId = section === 'folders' ? activeSavedSearchId : null;

    if (section !== prevSection) {
      untrack(() => {
        // Reset mobile history stack when switching sections via IconNav
        if (isMobile) resetMobileHistory();

        // Entering a section resets the folder scope, with two exceptions.
        // Periodic transitions arrive with activeFolderId already set
        // (handlePeriodic, same batch), so they keep it. Entering Folders on
        // desktop restores the last folder visited this session (fallback: first
        // folder) so the main pane isn't an empty dead-end (#384); mobile keeps
        // showing the folder tree, so it still clears. Everything else
        // (all/starred/tags/...) clears to undefined.
        //
        // Note creation reads the store's currentFolderId (set by setFolder
        // below), not activeFolderId directly - and every non-Folders section
        // clears it - so a restored folder never leaks into notes made elsewhere.
        if (isPeriodicSection(section)) {
          // keep handlePeriodic's folder id
        } else if (section === 'folders' && !isMobile) {
          activeFolderId = resolveFoldersEntryFolderId();
        } else {
          activeFolderId = undefined;
        }
        // A section switch always exits any open smart folder - entering Folders
        // fresh lands on a real folder (#384), not the previously-open smart one.
        activeSavedSearchId = null;
        if (section !== 'tags') {
          activeTagId = null;
          tagManager.resetSection();
        }
        // Periodic sections own activeNoteId via handlePeriodic - don't clear it
        // here or the freshly-opened periodic note would deselect on first paint.
        // A pending cross-section open (pendingOpenNoteId, e.g. "open source note"
        // from a share) is adopted after the flush instead of cleared, so the
        // requested note survives the transition. The clear is async (.then), so
        // setting activeNoteId here before the flush resolves would lose the race -
        // adopting inside the same continuation is what makes it deterministic.
        if (!isPeriodicSection(section)) {
          const adoptNoteId = pendingOpenNoteId;
          pendingOpenNoteId = null;
          noteDetailService.flushAndSnapshot().then(() => activeNoteId.set(adoptNoteId));
        }

        // Push history entry for drill-down sections (folders/tags)
        if (isMobile && (section === 'folders' || section === 'tags')) {
          pushMobileHistory();
        }

        // Leaving any section drops the share selection; entering Shares pulls a
        // fresh list (mirrors the old dialog's refresh-on-open).
        activeShareId.set(null);
        if (section === 'shares') void sharesStore.refresh();
      });
      prevSection = section;
    }

    // Read after the section-change reset above, so a restored Folders-entry id
    // (#384) reaches the notes filter (setFolder) in this same pass.
    const folderId = sectionUsesFolderId ? activeFolderId : undefined;

    // untrack: store updates are write-only side effects -
    // this effect should only react to section/folder/tag changes, not store internals.
    untrack(() => {
      if (section === 'trash') {
        notesStore.setTrash(true);
      } else if (section === 'starred') {
        notesStore.setStarred(true);
      } else if (section === 'tags' && tagId) {
        notesStore.setTag(tagId);
      } else if (savedSearchId) {
        // Smart folder: membership = the saved query, scope = whole vault. Read
        // the query untracked (activeSavedSearch is store-derived) so this effect
        // tracks only nav state, not every saved-searches store tick.
        const search = activeSavedSearch;
        if (search) notesStore.setSmartFolder(search.query, search.search_in_content);
        else notesStore.setFolder(undefined);
      } else if (sectionUsesFolderId) {
        notesStore.setFolder(folderId);
      } else if (section === 'shares') {
        // Shares view is backed by its own store (sharesStore) - leave the
        // notes filter as-is.
      } else {
        notesStore.setFolder(undefined);
      }
    });
  });

  // Drop a smart folder whose saved search was deleted while open: its row
  // vanishes from the tree, so without this the stale results + header name
  // would linger. Falls back to the folder tree (mobile) / empty pane (desktop).
  $effect(() => {
    if (activeSavedSearchId !== null && activeSavedSearch === null) {
      untrack(() => exitSmartFolder());
    }
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
    // The per-note editor-mode override is ephemeral: leaving a note (or opening
    // another) reverts to the Settings > Behavior default, so an accidental
    // switch to raw markdown self-heals on reopen.
    editorModeOverride.set(null);

    const prev = prevNoteId;
    prevNoteId = id;

    if (!id) {
      if (prev) {
        // leaveNote discards a pristine ephemeral note (#349) or flushes+snapshots
        // a touched one. isUntouchedThisLoad() reads prev's state synchronously
        // here, before reset() clears it below.
        untrack(() => noteDetailService.leaveNote(prev));
      }
      untrack(() => noteDetailService.reset());
      return;
    }

    if (untrack(() => noteDetailService.isNewNote)) {
      viewMode = 'edit';
    } else {
      // Existing note: open in the per-device default view mode (#351). Read
      // untracked via get() so changing the preference later doesn't re-run
      // this effect for the already-open note. effectiveViewMode clamps 'split'
      // to 'edit' on mobile, so 'split' is safe to set here.
      viewMode = get(noteOpenMode);
    }
    untrack(() => noteDetailService.loadNote(id));
  });

  // ── New note ─────────────────────────────────────────────────────
  let editorModeIntroOpen = $state(false);

  /** Create an ephemeral note (#349: saved locally with a real id so the editor
   *  can open it, but its push is deferred until the first deliberate action; if
   *  the user backs out untouched, leaveNote discards it and the server never
   *  sees it) in `folderId` - or the store's current folder when omitted - then
   *  open it in the editor. */
  async function createEphemeralNote(folderId?: string) {
    const date = new Date().toISOString().slice(0, 10);
    const settings = await getSettings();
    const prefix = settings?.language === 'pl' ? 'Notatka' : 'Note';
    const id = await notesStore.create(`${prefix} ${date}`, '', folderId, { ephemeral: true });
    noteDetailService.setNewNote();
    activeNoteId.set(id);
  }

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
    await createEphemeralNote();
  }

  /** "New note in this folder" from the folder tree (right-click menu / kebab):
   *  navigate into the folder so the note shows in context, then create it there. */
  async function handleNewNoteInFolder(folderId: string) {
    if (!$editorModeIntroSeen) {
      editorModeIntroOpen = true;
      return;
    }
    await handleFolderSelect(folderId);
    await tick();
    await createEphemeralNote(folderId);
  }

  async function handlePeriodic(kind: PeriodicKind) {
    // A re-click on the kind already resolving is a no-op: getOrCreateNote is
    // awaiting the (single-flight) initial-sync pull, so a second call would
    // just duplicate the await.
    if (periodicPendingKind === kind) return;
    // Anti-flicker: only surface the button spinner if the resolve actually
    // takes a beat (during the initial-sync pull, getOrCreateNote awaits it). A
    // steady-state index hit returns in a few ms and must not flash a spinner.
    let resolved = false;
    const spinnerTimer = setTimeout(() => {
      if (!resolved) periodicPendingKind = kind;
    }, 150);
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
    } finally {
      resolved = true;
      clearTimeout(spinnerTimer);
      periodicPendingKind = null;
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
  // Both handlers arm an inline draft input at the top of the relevant list
  // (root tree for new folder, SubfolderList for new subfolder) instead of
  // pre-creating the folder. The folder is created only when the user commits
  // a non-empty name — see `pendingNewFolderDraft`.
  function handleNewFolder() {
    pendingNewFolderDraft.set({ parentId: null });
  }

  function handleNewSubfolder() {
    if (!activeFolderId) return;
    expandedIds.add(activeFolderId);
    pendingNewFolderDraft.set({ parentId: activeFolderId });
  }

  async function handleSectionClick(section: Section) {
    // Fires on every IconNav click. Resets sub-selection when re-clicking the
    // already-active section so users can always get back to the section root.
    if (section !== activeSection) return;
    if (section === 'folders' && (activeFolderId !== undefined || activeSavedSearchId !== null)) {
      if (isMobile) {
        // Collapse back to the full-screen folder tree.
        await noteDetailService.flushAndSnapshot();
        resetMobileHistory();
        activeFolderId = undefined;
        activeSavedSearchId = null;
        activeNoteId.set(null);
        mobileView = 'folder-tree';
        pushMobileHistory();
      } else if (activeSavedSearchId !== null) {
        // Desktop keeps the folder tree permanently in the sidebar, so a plain
        // folder has no "tree root" to collapse to - clearing it would just
        // strand an empty "All notes" pane (#384). Only an open smart folder has
        // somewhere to back out to: exit it onto the entry folder. A plain folder
        // selection is left as-is, so re-clicking the active rail icon is a no-op.
        await noteDetailService.flushAndSnapshot();
        activeNoteId.set(null);
        exitSmartFolder();
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
    // Selecting a real folder (or the tree root) leaves any open smart folder.
    activeSavedSearchId = null;
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

  /** Leave the open smart folder: back to the folder tree (mobile) or onto the
   *  entry folder (desktop). Desktop has no empty tree-root state (#384), so
   *  landing on undefined would strand a headerless empty "All notes" pane.
   *  Leaves any open note untouched - it's independent of the smart folder, and
   *  closing it here (e.g. from the deleted-search guard) could drop pending edits. */
  function exitSmartFolder() {
    activeSavedSearchId = null;
    if (isMobile) {
      mobileView = 'folder-tree';
    } else {
      activeFolderId = resolveFoldersEntryFolderId();
    }
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

  /**
   * Scope of the CURRENT list view, composed into the query by the save
   * dialog so a view saved from a scoped context reproduces what the user
   * sees (mirrors the filter-sync effect above: trash has no operator and
   * hides the save affordance instead).
   */
  const saveScope = $derived.by((): SaveScope | null => {
    if (activeSection === 'starred') return { kind: 'starred' };
    if (activeSection === 'tags' && activeTagId) {
      const tag = $tagsStore.find((t) => t.id === activeTagId);
      return tag ? { kind: 'tag', name: tag.name } : null;
    }
    const usesFolder = activeSection === 'folders' || isPeriodicSection(activeSection);
    if (usesFolder && typeof activeFolderId === 'string') {
      const path = buildBreadcrumb($foldersStore, activeFolderId)
        .map((c) => c.name)
        .join('/');
      if (!path) return null;
      return { kind: 'folder', folderId: activeFolderId, folderName: activeFolderName, path };
    }
    return null;
  });

  // ── Saved searches in the folder tree ──────────────────────────
  const savedSearchesByFolder = $derived.by(() => {
    const map = new SvelteMap<string, SavedSearchDecrypted[]>();
    for (const search of $savedSearchesStore) {
      if (!search.folder_id) continue;
      const parked = map.get(search.folder_id);
      if (parked) parked.push(search);
      else map.set(search.folder_id, [search]);
    }
    return map;
  });

  // Searches pinned to the top level (smart folders) render above the folder list.
  // folder_id wins over the root flag, so a folder-pinned search never shows here.
  const rootPinnedSearches = $derived(
    $savedSearchesStore.filter((s) => s.pinned_to_root && !s.folder_id)
  );

  /**
   * Clicking a pinned saved search opens it as a smart folder: results render in
   * the main list (desktop) / list view (mobile) with the folder tree intact, and
   * the saved query becomes the list's membership filter (notesStore.setSmartFolder,
   * wired by the section effect). The in-list search box then sub-filters WITHIN it.
   * Stays in the Folders section so the rail keeps Folders active - the Search
   * section remains for ad-hoc queries, independent of smart folders.
   */
  async function handleSavedSearchSelect(search: SavedSearchDecrypted) {
    await noteDetailService.flushAndSnapshot();
    activeSection = 'folders';
    activeFolderId = undefined;
    activeSavedSearchId = search.id;
    activeNoteId.set(null);
    if (isMobile) {
      mobileView = 'list';
      pushMobileHistory();
    }
  }

  // ── Autosave (delegated to noteDetailService) ─────────────────
  function handleContentChange(content: string) {
    noteDetailService.setContentDebounced(content);
  }

  // ── In-note table of contents (note "..." menu) ───────────────
  // Same source mutation as the preview's TOC toolbar, but reachable in every
  // view mode (incl. edit-only, where there is no preview). `tocMenuMode` decides
  // which item(s) the menu shows; `tocStaleMenu` flags a drifted block. The
  // `applyToc(...) !== null` probe doubles as "the note has headings to list".
  const noteHasToc = $derived(hasToc(noteDetailService.content));
  const tocMenuMode: 'insert' | 'manage' | 'hidden' = $derived(
    noteHasToc
      ? 'manage'
      : applyToc(noteDetailService.content, { title: $t('toc.title') }) !== null
        ? 'insert'
        : 'hidden'
  );
  const tocStaleMenu = $derived(isTocStale(noteDetailService.content, { title: $t('toc.title') }));

  function handleDetailTocApply(): void {
    const next = applyToc(noteDetailService.content, { title: $t('toc.title') });
    if (next !== null) handleContentChange(next);
  }
  function handleDetailTocRemove(): void {
    const next = removeToc(noteDetailService.content);
    if (next !== null) handleContentChange(next);
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
  // A cross-note `note:UUID#slug` click carries an anchor. We can't scroll until
  // the target note has rendered, so we stash {noteId, slug} and consume it in
  // `handlePreviewRender` (which also re-fires after images load). Pairing the
  // slug with its note id keeps a stale anchor from firing on an unrelated note.
  let pendingAnchor = $state<{ noteId: string; slug: string } | null>(null);

  // ── Note navigation history (Back / Forward between notes) ───────
  // Browser-like trail of visited notes. The recorder $effect (declared just
  // above the scroll-reset effect) records every note that becomes active and
  // captures the outgoing note's scroll; Back/Forward move the cursor and ask
  // for a scroll restore. `suppressHistoryRecord` marks an activeNoteId change
  // that came from Back/Forward itself, so it isn't recorded as a new visit.
  let suppressHistoryRecord = false;
  // Armed for exactly one activeNoteId change by handleNoteLink, so following an
  // internal `note:` link EXTENDS the trail (Back returns to the source note).
  // Every other open (list pick, new note, periodic) leaves it false and starts
  // a fresh trail, so Back closes the note back to its list/section.
  let extendNavTrailOnce = false;
  let prevHistoryNoteId: string | null = null;
  let pendingScrollRestore = $state<{ noteId: string; top: number } | null>(null);

  const backNoteTitle = $derived(
    noteNavHistory.backTargetId ? (noteIndex.get(noteNavHistory.backTargetId)?.title ?? '') : ''
  );
  const forwardNoteTitle = $derived(
    noteNavHistory.forwardTargetId
      ? (noteIndex.get(noteNavHistory.forwardTargetId)?.title ?? '')
      : ''
  );

  /** The scroll container that actually scrolls the open note, per view mode. */
  function activeNoteScrollEl(): HTMLElement | null {
    if (isMobile) return mobileScrollContainer ?? null;
    if (effectiveViewMode === 'split') return previewScrollEl ?? null;
    if (effectiveViewMode === 'edit') return editorView?.scrollDOM ?? desktopEditorScrollContainer ?? null;
    return desktopEditorScrollContainer ?? null; // preview
  }

  /** Apply a pending Back/Forward scroll restore once the target note is laid out. */
  function applyPendingScrollRestore() {
    const target = pendingScrollRestore;
    if (!target || target.noteId !== $activeNoteId) return;
    const el = activeNoteScrollEl();
    if (el) el.scrollTop = target.top;
    pendingScrollRestore = null;
  }

  /** Step the navigation trail to a validated target and restore its scroll. */
  async function navigateNavHistory(dir: 'back' | 'forward') {
    const targetId = dir === 'back' ? noteNavHistory.backTargetId : noteNavHistory.forwardTargetId;
    if (!targetId) return;
    await noteDetailService.flushAndSnapshot();
    const note = await notesStore.loadNote(targetId);
    if (!note) {
      toastStore.error($t('notes.note_not_found'));
      noteNavHistory.remove(targetId); // broken entry - drop so it's skipped next time
      return;
    }
    if (note.is_archived) {
      toastStore.info($t('notes.note_in_trash'));
      noteNavHistory.remove(targetId);
      return;
    }
    // Commit the cursor move now that the target is known-good.
    if (dir === 'back') noteNavHistory.back();
    else noteNavHistory.forward();
    suppressHistoryRecord = true;
    pendingScrollRestore = { noteId: targetId, top: noteNavHistory.getScroll(targetId) };
    activeNoteId.set(targetId);
    // Preview/split restore via handlePreviewRender; edit-only has no render
    // callback, so nudge a restore on the next frame as well (idempotent - the
    // first apply clears the pending state).
    tick().then(() => requestAnimationFrame(applyPendingScrollRestore));
  }

  function goBackNote() {
    void navigateNavHistory('back');
  }
  function goForwardNote() {
    void navigateNavHistory('forward');
  }

  async function handleNoteLink(noteId: string, anchor?: string) {
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
    // The anchor can arrive percent-encoded: marked encodes non-ASCII slug chars
    // in the rendered href (Polish `ą` → `%C4%85`), so a heading link clicked in
    // the PREVIEW hands us the encoded form, while the heading ids stamped by
    // MarkdownPreview are raw Unicode. Decode so `scrollToHeading` matches. The
    // editor (Live Preview) path passes a raw slug straight from the markdown
    // source, where decode is a harmless no-op (slugs never contain `%`).
    let slug = anchor;
    if (slug) {
      try {
        slug = decodeURIComponent(slug);
      } catch {
        /* malformed %-escape - fall back to the raw anchor */
      }
    }
    pendingAnchor = slug ? { noteId, slug } : null;
    // Chain onto the trail so Back returns to this source note. Guard the
    // self-link no-op: if the target is already open, activeNoteId.set won't
    // fire the recorder, so don't leave the flag armed for the next open.
    extendNavTrailOnce = noteId !== $activeNoteId;
    activeNoteId.set(noteId);
  }

  /** "Open source note" from a share's detail panel: jump from the frozen
   *  snapshot to the live note it was created from. Re-validate first (the note
   *  may have been deleted or trashed since the panel rendered - the panel
   *  disables the action proactively, this is the render→click safety net), then
   *  arm pendingOpenNoteId and switch to All notes. The section-sync effect adopts
   *  the id after its flush. Only ever called from the Shares section, so the
   *  section transition (and thus the adopt) is guaranteed to fire. */
  async function handleOpenSourceNote(sourceId: string) {
    const note = await notesStore.loadNote(sourceId);
    if (!note) {
      toastStore.error($t('notes.note_not_found'));
      return;
    }
    if (note.is_archived) {
      toastStore.info($t('notes.note_in_trash'));
      return;
    }
    pendingOpenNoteId = sourceId;
    activeSection = 'all';
    activeFolderId = undefined;
    activeTagId = null;
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
  // Scroll-spy for the Outline panel: the heading slug currently near the top of
  // the preview, plus a tick bumped on each preview render so the observer
  // re-attaches to freshly rendered heading elements.
  let activeOutlineSlug = $state<string | null>(null);
  let previewRenderTick = $state(0);
  // An outline click sets the active entry directly for instant feedback, then
  // "locks" it so the scroll-spy - especially the at-bottom "last heading" rule -
  // doesn't overwrite it while the programmatic scroll is still moving. The lock
  // releases once scrolling has been quiet for a beat (settle-debounce), so it
  // holds for the WHOLE smooth scroll however long it runs (a fixed timer would
  // release mid-scroll on long notes and flicker through passing sections). Plain
  // non-reactive flag: read imperatively in the spy, never in a tracked context.
  let outlineNavLocked = false;
  let outlineNavSettleTimer: ReturnType<typeof setTimeout> | undefined;

  // Release the click-lock after motion settles. Re-armed on every scroll tick
  // while locked, so it only fires once the (programmatic) scroll stops; also
  // armed by the click itself, covering the no-scroll case (clicking a section
  // the note can't scroll any further - e.g. already at the bottom).
  function scheduleOutlineNavUnlock() {
    clearTimeout(outlineNavSettleTimer);
    outlineNavSettleTimer = setTimeout(() => {
      outlineNavLocked = false;
    }, 150);
  }
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

  // Record note visits for Back/Forward navigation and capture the OUTGOING
  // note's scroll position before the reset effect below zeroes it. Declared
  // before that effect so it runs first on each $activeNoteId change. Reads
  // refs/mode inside untrack so it depends only on $activeNoteId (mirrors the
  // reset effect's reasoning).
  $effect(() => {
    const id = $activeNoteId;
    untrack(() => {
      if (prevHistoryNoteId != null) {
        const el = activeNoteScrollEl();
        if (el) noteNavHistory.saveScroll(prevHistoryNoteId, el.scrollTop);
      }
      if (id != null && !suppressHistoryRecord) {
        // A fresh top-level open starts a new trail so Back closes the note back
        // to its list/section; only an internal `note:` link (incl. the
        // Linked-notes panel, which routes through handleNoteLink) extends it.
        if (extendNavTrailOnce) noteNavHistory.visit(id);
        else noteNavHistory.reset(id);
      }
      suppressHistoryRecord = false;
      extendNavTrailOnce = false;
      prevHistoryNoteId = id;
    });
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
    const navId = $activeNoteId;
    untrack(() => {
      scrollSync.setAnchor(1);
      // When this navigation targets a heading anchor (cross-note `note:UUID#slug`),
      // do NOT zero the scroll - `handlePreviewRender` is about to scroll the new
      // note to its heading, and a competing scrollTop=0 (effect order is not
      // guaranteed) would land us back at the top.
      if (pendingAnchor?.noteId === navId && navId != null) return;
      // Same deferral for a Back/Forward scroll restore - applyPendingScrollRestore
      // sets the saved offset after render; zeroing here would fight it.
      if (pendingScrollRestore?.noteId === navId && navId != null) return;
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
    previewRenderTick++;
    // Restore a Back/Forward scroll position once the target note has rendered.
    applyPendingScrollRestore();
    // Consume a pending cross-note heading anchor once its note has rendered.
    // Clear it on a note mismatch (a different note rendered first) so a stale
    // anchor never fires on an unrelated note.
    const target = pendingAnchor;
    if (!target) return;
    if (target.noteId !== $activeNoteId) {
      pendingAnchor = null;
      return;
    }
    if (scrollToHeading(previewContentEl, target.slug)) pendingAnchor = null;
  }

  // Scroll-spy: while the Outline panel is open, observe the preview's headings
  // and mark the topmost one near the top of the scroll viewport as active.
  // Re-attaches when the preview re-renders (new heading elements) or the note
  // changes; no-op when the panel is closed or no preview is mounted (edit-only).
  $effect(() => {
    if (!outlineVisible) {
      activeOutlineSlug = null;
      return;
    }
    void previewRenderTick;
    void $activeNoteId;
    const container = previewContentEl;
    const root = previewSyncScrollEl;
    if (!container) return;
    const headings = [...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
    if (headings.length === 0) return;

    const visible = new SvelteSet<string>();

    const computeActive = () => {
      // A recent outline click owns the highlight until its scroll settles.
      if (outlineNavLocked) return;
      // At the very bottom of a scrollable pane the trailing sections are on
      // screen but can't be pushed up into the trigger zone (no content below),
      // so the spy would stay stuck on whatever is near the top. Promote the
      // last heading instead - the "you've reached the end" convention
      // (VitePress / Bootstrap). Guarded on the pane actually being scrollable,
      // so a short note that fully fits keeps its top heading active rather than
      // jumping to the last one while you're looking at the top.
      if (
        root &&
        root.scrollHeight > root.clientHeight + 4 &&
        root.scrollTop + root.clientHeight >= root.scrollHeight - 2
      ) {
        activeOutlineSlug = headings[headings.length - 1].id;
        return;
      }
      // Otherwise: first heading (document order) in the trigger zone near the
      // top. When none are (scrolled mid-section), keep the last active one.
      for (const heading of headings) {
        if (visible.has(heading.id)) {
          activeOutlineSlug = heading.id;
          break;
        }
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        computeActive();
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );
    headings.forEach((heading) => observer.observe(heading));

    // The observer only fires when a heading crosses the trigger zone; the final
    // stretch of scroll to the very bottom crosses none, so also recompute on
    // scroll to catch reaching the end. While a click-lock is active, treat each
    // scroll tick as "still settling" instead of recomputing - this keeps the
    // clicked entry highlighted through the entire programmatic scroll (no
    // flicker), and the lock releases a beat after motion stops.
    const onScroll = () => {
      if (outlineNavLocked) {
        scheduleOutlineNavUnlock();
        return;
      }
      computeActive();
    };
    root?.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      observer.disconnect();
      root?.removeEventListener('scroll', onScroll);
    };
  });

  function handleEditorViewInit(view: EditorView) {
    editorView = view;
  }

  function handleEditorViewDestroy() {
    editorView = null;
  }

  // ── In-note search (find in note) ─────────────────────────────────
  // Client-side find over the OPEN note. One bar drives two backends by view
  // mode: the CodeMirror editor (edit/split) via mark decorations, and the
  // rendered preview (preview) via the CSS Custom Highlight API. Everything runs
  // in the browser over already-decrypted, in-memory content — nothing is sent
  // to or logged on the server (Zero Knowledge preserved).
  let searchOpen = $state(false);
  let searchQuery = $state('');
  let searchCaseSensitive = $state(false);
  let searchActiveIndex = $state(-1); // 0-based; -1 when there are no matches
  let searchFocusSignal = $state(0); // bumped to (re)focus + select the bar input
  let cmMatches = $state<SearchMatch[]>([]);
  let domMatches = $state<Range[]>([]);
  // Scroll to the active match only on explicit navigation / query change — never
  // on a plain content edit, so typing with search open doesn't yank the viewport.
  let pendingSearchScroll = $state(false);

  const searchTotal = $derived(
    effectiveViewMode === 'preview' ? domMatches.length : cmMatches.length
  );
  const searchCapped = $derived(searchTotal >= NOTE_SEARCH_MATCH_CAP);
  const searchCurrent = $derived(
    searchActiveIndex >= 0 && searchTotal > 0 ? searchActiveIndex + 1 : 0
  );

  function openNoteSearch() {
    if (!searchOpen) {
      // Seed from a non-empty single-line editor selection (find-bar convention).
      const view = editorView;
      if (view) {
        const sel = view.state.selection.main;
        if (!sel.empty) {
          const picked = view.state.sliceDoc(sel.from, sel.to);
          if (picked && !picked.includes('\n') && picked.length <= 200) searchQuery = picked;
        }
      }
      searchActiveIndex = searchQuery ? 0 : -1;
      searchOpen = true;
    }
    // Re-triggering Ctrl/Cmd+F on an open bar just refocuses + selects the input.
    pendingSearchScroll = true;
    searchFocusSignal++;
  }

  function closeNoteSearch() {
    if (!searchOpen) return;
    searchOpen = false;
    pendingSearchScroll = false;
    cmMatches = [];
    domMatches = [];
    clearDomHighlights();
    editorView?.dispatch({ effects: setNoteSearch.of(null) });
    // Return focus to the editor so typing resumes where the user left off.
    if (effectiveViewMode !== 'preview') editorView?.focus();
  }

  function handleSearchInput(value: string) {
    searchQuery = value;
    searchActiveIndex = value ? 0 : -1; // a new query jumps to the first match
    pendingSearchScroll = true;
  }

  function toggleSearchCase() {
    searchCaseSensitive = !searchCaseSensitive;
    searchActiveIndex = searchQuery ? 0 : -1;
    pendingSearchScroll = true;
    searchFocusSignal++;
  }

  function stepSearch(delta: 1 | -1) {
    if (searchTotal === 0) return;
    const base = searchActiveIndex < 0 ? 0 : searchActiveIndex;
    searchActiveIndex = (base + delta + searchTotal) % searchTotal;
    pendingSearchScroll = true;
  }

  // Recompute matches for the ACTIVE surface as the query / doc / preview change.
  // Writes only the match arrays (never activeIndex) to avoid a reactive loop.
  $effect(() => {
    if (!searchOpen || $activeNoteId == null || historyMode !== 'closed') {
      cmMatches = [];
      domMatches = [];
      return;
    }
    const query = searchQuery;
    const caseSensitive = searchCaseSensitive;
    if (effectiveViewMode === 'preview') {
      void previewRenderTick; // re-run after each preview re-render
      domMatches = findDomMatchRanges(previewContentEl, query, caseSensitive);
      cmMatches = [];
    } else {
      const text = noteDetailService.content; // offsets line up with the CM doc
      let matches = query ? findMatches(text, query, caseSensitive) : [];
      // Live Preview renders a managed TOC as a widget showing only entry labels;
      // its `#slug` link targets (kebab dups of the headings) are never visible,
      // so drop matches there to keep the count/navigation aligned with what the
      // reader sees. Raw editor mode shows the slugs verbatim, so keep them.
      if (effectiveViewMode === 'edit' && $effectiveEditorMode === 'live' && matches.length) {
        matches = excludeMatchesInSpans(matches, tocHiddenSpans(text));
      }
      cmMatches = matches;
      domMatches = [];
    }
  });

  // Keep activeIndex valid as the match set changes (clamp on shrink, preserve
  // otherwise). Writes inside untrack so it never re-triggers itself.
  $effect(() => {
    const total = effectiveViewMode === 'preview' ? domMatches.length : cmMatches.length;
    untrack(() => {
      if (total === 0) {
        if (searchActiveIndex !== -1) searchActiveIndex = -1;
      } else if (searchActiveIndex < 0 || searchActiveIndex >= total) {
        searchActiveIndex = 0;
      }
    });
  });

  // Paint highlights on the active surface and clear the other one.
  $effect(() => {
    const mode = effectiveViewMode;
    const active = searchActiveIndex;
    if (mode === 'preview') {
      const ranges = domMatches;
      editorView?.dispatch({ effects: setNoteSearch.of(null) });
      paintDomHighlights(ranges, active);
    } else {
      const matches = cmMatches;
      clearDomHighlights();
      editorView?.dispatch({
        effects: setNoteSearch.of(
          matches.length
            ? { matches, active, query: searchQuery, caseSensitive: searchCaseSensitive }
            : null
        )
      });
    }
  });

  // Scroll the active match into view, but only when navigation / a query change
  // asked for it (pendingSearchScroll) — not on every recompute.
  $effect(() => {
    const mode = effectiveViewMode;
    const matches = mode === 'preview' ? domMatches : cmMatches;
    const active = searchActiveIndex;
    if (!pendingSearchScroll) return;
    if (active < 0 || active >= matches.length) return;
    if (mode === 'preview') {
      scrollDomRangeIntoView(previewSyncScrollEl, matches[active] as Range);
    } else if (editorView) {
      scrollCmMatchIntoView(editorView, matches[active] as SearchMatch);
    }
    pendingSearchScroll = false;
  });

  // Close search when leaving the note or entering version history / trash diff.
  $effect(() => {
    if ($activeNoteId == null || historyMode !== 'closed') {
      if (searchOpen) closeNoteSearch();
    }
  });

  // ── Folder breadcrumb navigation ──────────────────────────────────
  // The section-change $effect above clears `activeFolderId` for any non-periodic
  // transition. So we set the target id AFTER tick() - once that clearing pass
  // has run - instead of in the same synchronous batch, where it would be wiped.
  async function navigateToNoteFolder() {
    const targetFolderId = noteDetailService.folderId as string | null | undefined;
    await noteDetailService.flushAndSnapshot();
    activeSection = 'folders';
    await tick();
    activeFolderId = targetFolderId;
    if (targetFolderId) {
      getAncestorIds(targetFolderId, $foldersStore).forEach((id) => expandedIds.add(id));
      expandedIds.add(targetFolderId);
      lastVisitedFolderId = targetFolderId;
    }
    activeNoteId.set(null);
    // Mobile: drill into the folder's note list (mirrors handleFolderSelect).
    // Without this we'd land on the folder tree with the target highlighted but
    // the user still has to tap it to see the notes - extra step.
    if (isMobile && targetFolderId) {
      mobileView = 'list';
      pushMobileHistory();
    }
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
    } else {
      // No unsaved edits: silently discard a pristine ephemeral note so
      // navigating away (e.g. to settings) leaves no ghost. Local-only and fast,
      // so no need to cancel the navigation. No-op for non-ephemeral notes. #349
      void noteDetailService.leaveNote();
    }
  });

  // ── Mobile + beforeunload + visibilitychange ──────────────────
  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    isMobile = mq.matches;
    mq.addEventListener('change', (e) => {
      isMobile = e.matches;
    });

    // Deep-link: /?section=shares (used by the Settings → Security shortcut)
    // opens the Shares view, then strips the param so a refresh / back doesn't
    // re-trigger it. Read before the mobile history guard snapshots the URL.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('section') === 'shares') {
        activeSection = 'shares';
      }
      if (params.has('section')) {
        history.replaceState(history.state, '', window.location.pathname + window.location.hash);
      }
    } catch {
      // URL parsing / history access can throw in exotic embeds - non-fatal.
    }

    // ── Mobile: virtual history guard entry ──────────────────────
    // Creates a "trampoline" entry so that native back gestures trigger
    // popstate instead of exiting the PWA.
    if (mq.matches) {
      history.replaceState({ _rn: 'guard' }, '');
      history.pushState({ _rn: 'app' }, '');
    }

    // window carries a custom popstate handler ref that must survive re-mounts
    type RnWindow = Window & { __rnPopstateHandler?: (e: PopStateEvent) => void };

    // Remove old persistent handler if re-mounting (e.g., returning from /settings)
    const existingHandler = (window as RnWindow).__rnPopstateHandler;
    if (existingHandler) {
      window.removeEventListener('popstate', existingHandler);
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

      // Trampoline: on the guard entry, re-push an app entry so a browser / PWA
      // back gesture never exits the app. Native: don't re-trap - the App
      // backButton handler exits at the guard root (see $lib/platform/native).
      if (e.state?._rn === 'guard') {
        if (!__REBORN_NATIVE__) history.pushState({ _rn: 'app' }, '');
      }
    }

    (window as RnWindow).__rnPopstateHandler = handlePopstate;
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

    // Native: the webview may not fire visibilitychange when the app is
    // backgrounded, so flush pending edits on the App 'pause' lifecycle event.
    // Native-only -> dead-code-eliminated from the web bundle.
    let offPause: (() => void) | undefined;
    if (__REBORN_NATIVE__) {
      offPause = platform.lifecycle.onPause(() => {
        if (noteDetailService.hasPendingChanges()) noteDetailService.flushAndSnapshot();
      });
    }

    return () => {
      mounted = false;
      // DON'T remove popstate handler - it must persist for settings→root navigation
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      offPause?.();
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
      return;
    }
    // Ctrl/Cmd+F — in-note find. Overrides the browser's page find while a note
    // is open (mirrors Google Docs / Notion / VS Code). Live note view only,
    // never in version history or trash.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F') && !e.shiftKey && !e.altKey) {
      if ($activeNoteId != null && historyMode === 'closed' && !activeTrash) {
        e.preventDefault();
        openNoteSearch();
      }
      return;
    }
    // Mod+E — toggle edit ↔ preview (Obsidian convention). The editing view uses
    // the mode from Settings > Behavior, or the open note's temporary override;
    // returning from preview restores the editing view you left (edit or split).
    // Live note view only — never in version history or trash. We preventDefault
    // so it also overrides Firefox's Ctrl+E (focus search bar).
    if ((e.metaKey || e.ctrlKey) && (e.key === 'e' || e.key === 'E') && !e.shiftKey && !e.altKey) {
      if ($activeNoteId != null && historyMode === 'closed' && !activeTrash) {
        e.preventDefault();
        if (effectiveViewMode === 'preview') {
          viewMode = lastEditViewMode;
        } else {
          lastEditViewMode = viewMode === 'split' ? 'split' : 'edit';
          viewMode = 'preview';
        }
      }
      return;
    }
    // Alt+Left / Alt+Right - Back / Forward between visited notes. Ignored when
    // focus is in the editor (there Alt+Arrow is CM6 word navigation) and only
    // while a note is open. Other modifiers excluded so it can't shadow combos.
    if (
      e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      $activeNoteId != null &&
      !(e.target as HTMLElement | null)?.closest('.cm-editor')
    ) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') goBackNote();
      else goForwardNote();
    }
  }}
/>

{#if isMobile}
  <!-- ══════════════════════════════════════════════════════════════════
     MOBILE: Master-Detail with two full-screen panels
     ══════════════════════════════════════════════════════════════════ -->
  <Tooltip.Provider delayDuration={0}>
    <!-- Mobile root: only the editor panel (Panel 2) needs visual-viewport
         sizing + counter-translate to neutralise iOS Safari "page-shift" of the
         contenteditable. Panel 1 (icon rail + list) only has plain inputs - if
         the root shrank to vv.height there too, the IconNav's flex-1 spacer
         would collapse and pull Settings/Avatar up under the section icons.
         Switch sizing strategy on $activeNoteId: vv-tracked when editor is in
         view, plain 100dvh otherwise (keyboard just covers the bottom, like
         the Task app). CSS vars emitted in +layout.svelte; the 100dvh fallback
         also covers SSR + browsers without visualViewport. -->
    <div
      class="relative overflow-hidden bg-sidebar"
      style={$activeNoteId
        ? 'height: calc(var(--rn-vv-height, 100dvh) - var(--rn-banner-h, 0px)); transform: translateY(var(--rn-vv-offset-top, 0px));'
        : 'height: calc(100dvh - var(--rn-banner-h, 0px));'}
    >
      <!-- ── Panel 1: Icon Rail + List ──────────────────────────────── -->
      <div
        class="absolute inset-0 flex transition-transform duration-300 ease-in-out"
        class:-translate-x-full={mobileDetailOpen}
      >
        <!-- Icon rail (vertical, always visible) -->
        <IconNav
          bind:activeSection
          onNewNote={handleNewNote}
          onsectionclick={handleSectionClick}
          onPeriodic={handlePeriodic}
          pendingKind={periodicPendingKind}
          alwaysVisible
        />

        <!-- Content area (list / folder tree / tag list) -->
        <div class="flex flex-1 flex-col min-w-0 overflow-hidden">
          <!-- Header (hidden when NoteList handles its own header) -->
          {#if !(mobileView === 'list' && noteListOwnsMobileHeader)}
            <!-- pt + min-h grow together by the iOS notch inset so the content
                 keeps its full 3.5rem box and stays vertically centered
                 (env() is 0 elsewhere) -->
            <div
              class="flex min-h-[calc(3.5rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-1 px-3 pt-[env(safe-area-inset-top,0px)] {activeSection ===
                'all' || activeSection === 'search'
                ? ''
                : 'border-b border-sidebar-border'}"
            >
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
                <!-- px-1 inside the px-3 bar lands the logo at the same 16px inset
                     as the px-4 title/meta rows in NoteList (unified app-bar). -->
                <span class="px-1">
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
                  {#if $foldersStore.length === 0 && !$pendingNewFolderDraft}
                    <p class="px-2 py-1 text-xs text-muted-foreground">
                      {$t('folders.no_folders_short')}
                    </p>
                  {:else}
                    <FolderTree
                      nodes={$foldersStore}
                      activeFolderId={activeFolderId ?? null}
                      {activeSavedSearchId}
                      {expandedIds}
                      onselect={handleFolderSelect}
                      onnewnote={handleNewNoteInFolder}
                      {savedSearchesByFolder}
                      {rootPinnedSearches}
                      onsavedsearchselect={handleSavedSearchSelect}
                    />
                  {/if}
                </div>
              </div>
            {:else if mobileView === 'tag-list'}
              <TagListMobile {activeTagId} onselect={handleTagSelect} bind:mobileNewTagInput />
            {:else if activeSection === 'shares'}
              <SharesList />
            {:else}
              <NoteList
                {activeFolderName}
                {activeSection}
                activeFolderId={activeFolderId ?? null}
                isTrash={activeTrash}
                isPeriodic={isPeriodicSection(activeSection)}
                subfolders={activeFolderSubfolders}
                onSubfolderSelect={handleFolderSelect}
                {saveScope}
                onsavedsearchselect={handleSavedSearchSelect}
                autoFocusSearch={activeSection === 'search'}
                searchOnly={activeSection === 'search'}
                prominentHeader={noteListOwnsMobileHeader}
                onback={activeSection === 'folders' &&
                (activeFolderId !== undefined || activeSavedSearchId !== null)
                  ? () => {
                      if (isMobile && mobileHistoryDepth > 0) {
                        history.back();
                      } else if (activeSavedSearchId !== null) {
                        exitSmartFolder();
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
                onNewSubfolder={activeSection === 'folders' && activeFolderId
                  ? handleNewSubfolder
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
        class:translate-x-full={!mobileDetailOpen}
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
              linkedNotesActive={linkedNotesOpen}
              ontogglelinkednotes={toggleLinkedNotes}
              outlineActive={outlineVisible}
              ontoggleoutline={toggleOutline}
              canGoBackNote={noteNavHistory.canGoBack}
              canGoForwardNote={noteNavHistory.canGoForward}
              {backNoteTitle}
              {forwardNoteTitle}
              onnotehistoryback={goBackNote}
              onnotehistoryforward={goForwardNote}
              onback={() => {
                if (noteNavHistory.canGoBack) {
                  goBackNote();
                } else if (isMobile && mobileHistoryDepth > 0) {
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
              noteId={$activeNoteId}
              onShareCreate={() => handleDetailShare()}
            >
              {#snippet actions()}
                <NoteDetailActions
                  note={detailMenuNote}
                  onmenuopen={() => (detailActionSheetOpen = true)}
                  onsearch={openNoteSearch}
                  onpin={handleDetailPin}
                  onstar={handleDetailStar}
                  onmove={handleDetailMoveDesktop}
                  onexport={() => handleDetailExport()}
                  onexportpdf={() => handleDetailExportPdf()}
                  oncopylink={() => handleDetailCopyLink()}
                  onshare={() => handleDetailShare()}
                  onshowxray={() => { showEncryptionXRay = true; }}
                  ondelete={handleDetailDelete}
                />
              {/snippet}
            </NoteEditorHeader>

            <!-- Scroll container + X-Ray overlay share one positioned box so the
                 overlay pins to the visible editor region, not the scroll
                 content (which grows with note length under parentScroll). -->
            <div class="relative flex flex-1 flex-col min-h-0">
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
                  imageLoadMode={$imageLoadMode}
                  noteKind={currentNoteKind}
                />
              </div>

              {#if searchOpen}
                <div class="absolute inset-x-0 top-0 z-30">
                  <NoteSearchBar
                    isMobile
                    query={searchQuery}
                    caseSensitive={searchCaseSensitive}
                    total={searchTotal}
                    current={searchCurrent}
                    capped={searchCapped}
                    focusSignal={searchFocusSignal}
                    oninput={handleSearchInput}
                    ontogglecase={toggleSearchCase}
                    onnext={() => stepSearch(1)}
                    onprev={() => stepSearch(-1)}
                    onclose={closeNoteSearch}
                  />
                </div>
              {/if}

              {#if showEncryptionXRay && historyMode === 'closed'}
                <EncryptionXRay
                  noteId={$activeNoteId}
                  plainTitle={noteDetailService.title}
                  plainContent={noteDetailService.content}
                  onclose={() => (showEncryptionXRay = false)}
                />
              {/if}
            </div>
          {/if}
        {:else if activeSection === 'shares' && $activeShareId}
          <ShareDetailPanel
            shareId={$activeShareId}
            onback={closeShareDetail}
            onopensource={handleOpenSourceNote}
          />
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
  <!-- Base the height on 100dvh, NOT on the measured visualViewport height: dvh
       is engine-tracked, so it follows a freely-resized window - the macOS
       "Designed for iPad" shell and iPad Stage Manager / Split View - whereas
       --rn-vv-height only refreshes on scroll / visualViewport events and goes
       stale on a window resize (editor then leaves empty space below / clips).
       The soft keyboard (iPad PWA Safari, iPad portrait <835px native) is still
       handled: --rn-keyboard-inset (emitted in +layout.svelte) is the overlay
       keyboard's height, 0 when closed, so the scroll container shrinks to the
       visible area exactly as the old vv.height pin did. -->
  <SidebarProvider
    class="bg-sidebar overflow-hidden"
    open={!panelCollapsedEffective}
    onOpenChange={(o) => devicePrefs.setNoteListCollapsed(!o)}
    style="height: calc(100dvh - var(--rn-banner-h, 0px) - var(--rn-keyboard-inset, 0px)); min-height: 0; --sidebar-width: 24rem;"
  >
    <SidebarAutoClose {closeSidebarSignal} />

    <!-- ── Icon rail (always visible; its first button toggles the note-list
         panel, mirrored by Cmd/Ctrl+B via the provider). ──────────── -->
    <IconNav
      bind:activeSection
      onNewNote={handleNewNote}
      onsectionclick={handleSectionClick}
      onPeriodic={handlePeriodic}
      pendingKind={periodicPendingKind}
    />

    <!-- ── Note-list panel (collapsible). Outer div animates width; the inner
         keeps a fixed 24rem width so its content never reflows mid-slide. ── -->
    <div
      class="shrink-0 overflow-hidden transition-[width] duration-200 ease-linear"
      style="width: {panelCollapsedEffective ? '0px' : '24rem'}"
    >
      <div class="flex h-full w-96 flex-col min-w-0 overflow-hidden bg-sidebar">
        <SidebarHeader class="p-0 gap-0">
          <!-- The editor card to the right floats with a my-2 (0.5rem) top
               margin, so its header separator sits 0.5rem below the column top.
               Mirror that offset here (min-h 3.5rem + a matching 0.5rem pt, both
               growing with the iOS notch inset, env() is 0 elsewhere). border-b
               sits on THIS box, not the SidebarHeader wrapper: with border-box it
               counts inside the 3.5rem height - exactly like the editor header's
               own border-b - so both separators land on the same pixel row. A
               border on the auto-height wrapper would render 1px lower instead. -->
          <div
            class="flex min-h-[calc(3.5rem+env(safe-area-inset-top,0px))] items-center gap-2 border-b px-5 pt-[calc(0.5rem+env(safe-area-inset-top,0px))]"
          >
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
                {#if $foldersStore.length === 0 && !$pendingNewFolderDraft}
                  <p class="px-2 py-4 text-center text-xs text-muted-foreground">
                    {$t('folders.no_folders_short')}
                  </p>
                {:else}
                  <FolderTree
                    nodes={$foldersStore}
                    activeFolderId={activeFolderId ?? null}
                    {activeSavedSearchId}
                    {expandedIds}
                    onselect={handleFolderSelect}
                    onnewnote={handleNewNoteInFolder}
                    {savedSearchesByFolder}
                    {rootPinnedSearches}
                    onsavedsearchselect={handleSavedSearchSelect}
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
          {:else if activeSection === 'shares'}
            <SharesList />
          {:else}
            <NoteList
              {activeFolderName}
              {activeSection}
              isTrash={activeTrash}
              isPeriodic={isPeriodicSection(activeSection)}
              {saveScope}
              oncreate={handleNewNote}
            />
          {/if}
        </SidebarContent>
        <SyncStatusFooter />
      </div>
    </div>

    <!-- ── Editor column (was SidebarInset; the variant=inset card classes are
         inlined here and the left margin follows the panel's collapsed state). ── -->
    <main
      class="bg-background relative flex flex-1 flex-col min-w-0 overflow-hidden my-2 mr-2 rounded-xl shadow-sm"
      class:ml-0={!panelCollapsedEffective}
      class:ml-2={panelCollapsedEffective}
    >
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
            linkedNotesActive={linkedNotesOpen}
            ontogglelinkednotes={toggleLinkedNotes}
            outlineActive={outlineVisible}
            ontoggleoutline={toggleOutline}
            canGoBackNote={noteNavHistory.canGoBack}
            canGoForwardNote={noteNavHistory.canGoForward}
            {backNoteTitle}
            {forwardNoteTitle}
            onnotehistoryback={goBackNote}
            onnotehistoryforward={goForwardNote}
            noteListCollapsed={$noteListCollapsed}
            onToggleNoteList={() => devicePrefs.toggleNoteList()}
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
            noteId={$activeNoteId}
            onShareCreate={() => handleDetailShare()}
          >
            {#snippet actions()}
              <NoteDetailActions
                note={detailMenuNote}
                onmenuopen={() => (detailActionSheetOpen = true)}
                onsearch={openNoteSearch}
                onpin={handleDetailPin}
                onstar={handleDetailStar}
                onmove={handleDetailMoveDesktop}
                onexport={() => handleDetailExport()}
                onexportpdf={() => handleDetailExportPdf()}
                oncopylink={() => handleDetailCopyLink()}
                onshare={() => handleDetailShare()}
                onshowxray={() => { showEncryptionXRay = true; }}
                ondelete={handleDetailDelete}
                {tocMenuMode}
                tocStale={tocStaleMenu}
                onTocApply={handleDetailTocApply}
                onTocRemove={handleDetailTocRemove}
              />
            {/snippet}
          </NoteEditorHeader>

          <!-- Scroll container + X-Ray overlay share one positioned box so the
               overlay pins to the visible editor region (not the scroll
               content) and fills it regardless of note length / scroll pos. -->
          <div class="relative flex flex-1 flex-col min-h-0">
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
                imageLoadMode={$imageLoadMode}
                noteKind={currentNoteKind}
              />
            </div>

            {#if searchOpen}
              <div class="absolute right-3 top-3 z-30">
                <NoteSearchBar
                  query={searchQuery}
                  caseSensitive={searchCaseSensitive}
                  total={searchTotal}
                  current={searchCurrent}
                  capped={searchCapped}
                  focusSignal={searchFocusSignal}
                  oninput={handleSearchInput}
                  ontogglecase={toggleSearchCase}
                  onnext={() => stepSearch(1)}
                  onprev={() => stepSearch(-1)}
                  onclose={closeNoteSearch}
                />
              </div>
            {/if}

            {#if showEncryptionXRay && historyMode === 'closed'}
              <EncryptionXRay
                noteId={$activeNoteId}
                plainTitle={noteDetailService.title}
                plainContent={noteDetailService.content}
                onclose={() => (showEncryptionXRay = false)}
              />
            {/if}
          </div>
        {/if}
      {:else if activeSection === 'shares'}
        {#if $activeShareId}
          <ShareDetailPanel
            shareId={$activeShareId}
            onback={closeShareDetail}
            onopensource={handleOpenSourceNote}
          />
        {:else}
          <header
            class="flex min-h-[calc(3rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-2 border-b border-border/60 px-6 pt-[env(safe-area-inset-top,0px)]"
          >
            <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {$t('share.list.title')}
            </span>
          </header>
          <div class="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Share2 class="h-8 w-8 opacity-40" />
            <p class="max-w-xs text-center text-sm">{$t('share.list.select_hint')}</p>
          </div>
        {/if}
      {:else if showNoteListInMain}
        <div
          class="mx-auto h-full w-full max-w-4xl px-6 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] flex flex-col"
        >
          <NoteList
            {activeFolderName}
            {activeSection}
            activeFolderId={activeFolderId ?? null}
            isTrash={false}
            isPeriodic={isPeriodicSection(activeSection)}
            showSidebarTrigger
            subfolders={activeFolderSubfolders}
            onSubfolderSelect={handleFolderSelect}
            {saveScope}
            onsavedsearchselect={handleSavedSearchSelect}
            onback={activeFolderParentId ? handleFolderBack : undefined}
            onNewSubfolder={activeSection === 'folders' && activeFolderId
              ? handleNewSubfolder
              : undefined}
            oncreate={handleNewNote}
          />
        </div>
      {:else}
        <header
          class="flex min-h-[calc(3rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-2 border-b border-border/60 px-6 pt-[env(safe-area-inset-top,0px)]"
        >
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
    </main>

    <!-- ── Docked outline (desktop, pinned, note has headings). Reserves layout
         space beside the editor and never closes on outside-click - the whole
         point of #375 vs. the overlay drawer. ──────────────────────────────── -->
    {#if tocDocked}
      <aside
        class="my-2 mr-2 flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm"
        aria-label={$t('outline.title')}
      >
        <div class="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <ListTree class="h-4 w-4 text-muted-foreground" />
          <span class="flex-1 truncate text-sm font-semibold">{$t('outline.title')}</span>
          <button
            type="button"
            onclick={unpinOutline}
            title={$t('outline.unpin')}
            aria-label={$t('outline.unpin')}
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground
                   transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <PinOff class="h-4 w-4" />
          </button>
        </div>
        <OutlineTree
          content={noteDetailService.content}
          activeSlug={activeOutlineSlug}
          onnavigate={handleOutlineNavigate}
          enabled={tocDocked}
        />
      </aside>
    {/if}
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

{#if $activeNoteId}
  <LinkedNotesSheet
    noteId={$activeNoteId}
    open={linkedNotesOpen}
    onnavigate={(id) => {
      void handleNoteLink(id);
      if (isMobile) linkedNotesOpen = false;
    }}
    onclose={() => {
      linkedNotesOpen = false;
    }}
  />
{/if}

{#if $activeNoteId}
  <OutlineSheet
    content={noteDetailService.content}
    open={tocFloating}
    activeSlug={activeOutlineSlug}
    onnavigate={handleOutlineNavigate}
    showPin={!isMobile}
    onpin={pinOutline}
    onclose={() => {
      outlineOpen = false;
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
  onsearch={openNoteSearch}
  onpin={() => handleDetailPin()}
  onstar={() => handleDetailStar()}
  onmove={() => handleDetailOpenMoveMobile()}
  onexport={(note) => handleDetailExport(note)}
  onexportpdf={(note) => handleDetailExportPdf(note)}
  oncopylink={(note) => handleDetailCopyLink(note)}
  onshare={(note) => handleDetailShare(note)}
  ondelete={() => handleDetailDelete()}
  onhistory={handleDetailHistory}
  onlinkednotes={handleDetailLinkedNotes}
  onoutline={handleDetailOutline}
  onshowxray={() => { showEncryptionXRay = true; }}
  onrestore={() => {}}
  onpermanentdelete={() => {}}
  {tocMenuMode}
  tocStale={tocStaleMenu}
  onTocApply={handleDetailTocApply}
  onTocRemove={handleDetailTocRemove}
/>

<!-- Detail-view move-to-folder (mobile bottom sheet) -->
{#if isMobile}
  <MoveToFolderMenu
    selection={detailMovingNoteId
      ? { kind: 'single', id: detailMovingNoteId, currentFolderId: noteDetailService.folderId ?? null }
      : null}
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

{#if shareNoteId}
  <ShareNoteDialog bind:open={shareDialogOpen} noteId={shareNoteId} noteTitle={shareNoteTitle} />
{/if}

<AccountRequiredDialog bind:open={accountRequiredOpen} />
