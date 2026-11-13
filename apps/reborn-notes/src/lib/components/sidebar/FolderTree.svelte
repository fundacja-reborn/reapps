<script module>
  import { writable } from 'svelte/store';
  import type { FolderWithChildren } from '@reborn/types';
  // Shared across all FolderTree instances (including recursive children).
  // Set to a folder ID to immediately enter rename mode for that folder.
  export const pendingRenameId = writable<string | null>(null);
  // Context key under which the root instance shares the tree's one dialog
  // host (FolderActionDialogs) with its nested instances.
  const DIALOGS_CONTEXT = Symbol('folder-tree-dialogs');
  // While a folder row is dragged: ids of that folder and its whole subtree.
  // dataTransfer payloads are unreadable during dragover, so rows consult this
  // store instead to refuse drops that would move a folder into itself.
  export const dragBlockedIds = writable<Set<string> | null>(null);
  // Row the active drag would drop on, and how (ring = into, insertion line =
  // before/after). Module-level because the touch drag is owned by the
  // instance where the press started, while the hovered row can belong to any
  // other instance in the recursion; the desktop dragover path writes it too.
  export type DropZone = 'into' | 'before' | 'after';
  export const dropTarget = writable<{ id: string; zone: DropZone } | null>(null);
  // Row lifted by an active touch drag - dimmed while its clone follows the finger.
  export const touchDraggingId = writable<string | null>(null);
  // One touch gesture at a time across ALL tree instances. Rows live in
  // recursive component instances, so the per-instance guards (pressTimer /
  // touchDragging) cannot see a press started at another depth - a second
  // concurrent long-press would overwrite the shared dragBlockedIds /
  // touchDraggingId stores and corrupt the first gesture's cycle guard.
  let touchGestureActive = false;
  function claimTouchGesture(): boolean {
    if (touchGestureActive) return false;
    touchGestureActive = true;
    return true;
  }
  function releaseTouchGesture() {
    touchGestureActive = false;
  }
</script>

<script lang="ts">
  import { getContext, setContext } from 'svelte';
  import { ChevronRight, Folder, FolderSync, MoreHorizontal, RefreshCw } from '@lucide/svelte';
  import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    toastStore
  } from '@reborn/ui';
  import { flip } from 'svelte/animate';
  import FolderGlyph from '$lib/components/folders/FolderGlyph.svelte';
  import FolderActionDialogs from '$lib/components/folders/FolderActionDialogs.svelte';
  import RowActionSheet from '$lib/components/shared/RowActionSheet.svelte';
  import { appearanceTextClass } from '$lib/utils/appearance-colors';
  import { isFolderIcon } from '$lib/utils/folder-icons';
  import { buildFolderActions } from '$lib/utils/folder-actions';
  import type { RowAction } from '$lib/utils/row-action';
  import { syncedFolderConfigs } from '$lib/services/folder-sync.service';
  // FolderWithChildren comes from the module script import above (module and
  // instance scripts compile into one module - re-importing here would clash).
  import type { SavedSearchDecrypted } from '@reborn/types';
  import { foldersStore } from '$lib/stores/folders.store';
  import { notesStore } from '$lib/stores/notes.store';
  import { folderSortMode } from '$lib/stores/app-settings.store';
  import {
    pendingNewFolderDraft,
    registerNewFolderDraftInput
  } from '$lib/stores/new-folder-draft.store';
  import { t } from '$lib/stores/i18n.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import {
    findChildrenOfParent,
    findParentAndSiblings,
    getDescendantFolderIds
  } from '$lib/utils/folder-helpers';
  import SavedSearchRow from '$lib/components/notes/SavedSearchRow.svelte';
  import FolderTree from './FolderTree.svelte';

  let {
    nodes,
    depth = 0,
    parentId = null,
    activeFolderId = null,
    activeSavedSearchId = null,
    expandedIds,
    onselect,
    onnewnote = undefined,
    savedSearchesByFolder = undefined,
    rootPinnedSearches = undefined,
    onsavedsearchselect = undefined
  }: {
    nodes: FolderWithChildren[];
    depth?: number;
    /** Parent folder of this sibling group - null at the root level. Custom
     *  sort reorder writes (drag between rows, move up/down) target it. */
    parentId?: string | null;
    activeFolderId?: string | null;
    /** Id of the smart folder (pinned saved search) currently open in the main
     *  list - highlights its row, mirroring activeFolderId for real folders. */
    activeSavedSearchId?: string | null;
    expandedIds: Set<string>;
    onselect: (id: string | null) => void;
    /** Create a new note inside the folder (parent owns the create + navigate). */
    onnewnote?: (folderId: string) => void;
    /** Saved searches parked per folder id - rendered as leaf nodes under the folder. */
    savedSearchesByFolder?: Map<string, SavedSearchDecrypted[]>;
    /** Searches pinned to the top level (smart folders) - rendered above the folder
     *  list at the root instance only (ignored for depth > 0). */
    rootPinnedSearches?: SavedSearchDecrypted[];
    onsavedsearchselect?: (search: SavedSearchDecrypted) => void;
  } = $props();

  // ── Inline rename state ─────────────────────────────────────────
  let editingId = $state<string | null>(null);
  let editingName = $state('');
  let editInputEl = $state<HTMLInputElement | undefined>(undefined);

  $effect(() => {
    const pendingId = $pendingRenameId;
    if (!pendingId) return;
    const found = nodes.find((n) => n.id === pendingId);
    if (found) {
      pendingRenameId.set(null); // claim - clear so sibling instances don't also trigger
      editingId = pendingId;
      editingName = found.name;
      setTimeout(() => editInputEl?.select(), 0);
    }
  });

  // ── Inline new-folder draft (root list only) ───────────────────
  // When `pendingNewFolderDraft.parentId === null`, the root FolderTree
  // (depth 0) renders an input row at the very top. Folder is created on
  // commit, not when the draft is requested. `openNewFolderDraft` focuses
  // the input (registered by the attachment) within the opening tap.
  let draftName = $state('');
  const showDraft = $derived(depth === 0 && $pendingNewFolderDraft?.parentId === null);

  $effect(() => {
    if (showDraft) draftName = $t('folders.new_folder');
  });

  async function commitDraft() {
    // Guard against re-entry: Enter and Escape both clear the store, which
    // removes the input from the DOM. The browser then fires a blur event on
    // the removed node, which would otherwise call commitDraft a second time.
    if (!$pendingNewFolderDraft) return;
    const trimmed = draftName.trim();
    pendingNewFolderDraft.set(null);
    if (trimmed) await foldersStore.create(trimmed);
  }

  function cancelDraft() {
    pendingNewFolderDraft.set(null);
  }

  function startRename(folder: FolderWithChildren) {
    editingId = folder.id;
    editingName = folder.name;
    // Focus after DOM update
    setTimeout(() => editInputEl?.select(), 0);
  }

  async function commitRename(id: string) {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== nodes.find((n) => n.id === id)?.name) {
      await foldersStore.rename(id, trimmed);
    }
    editingId = null;
  }

  function cancelRename() {
    editingId = null;
  }

  function handleRowSelect(folder: FolderWithChildren) {
    if ((folder.children?.length ?? 0) > 0) {
      expandedIds.add(folder.id);
    }
    onselect(folder.id);
  }

  // Undecryptable rows (foreign key epoch / corrupted ciphertext) render an
  // explicit placeholder instead of a blank name. Unlike saved searches
  // (Delete-only, #410), the name is a folder's ONLY ciphertext: selection,
  // expansion and the subtree stay fully usable, and a rename re-encrypts the
  // name under the current key - i.e. repairs the row - so the menu offers
  // Rename + Delete.
  function folderDisplayName(folder: FolderWithChildren): string {
    return folder.decrypt_failed ? $t('folders.undecryptable') : folder.name;
  }

  // ── Folder menu (kebab / right-click / phone sheet) ─────────────
  const isMobileQuery = useIsMobile();
  // Desktop: the row whose kebab or right-click menu is open.
  let menuOpenId = $state<string | null>(null);
  // Phone: the action sheet and the row it was opened for. The id outlives
  // the sheet, so its content stays put through the closing animation.
  let folderActionSheetOpen = $state(false);
  let sheetFolderId = $state<string | null>(null);
  const sheetFolder = $derived(
    sheetFolderId ? (nodes.find((n) => n.id === sheetFolderId) ?? null) : null
  );

  // Dialogs behind the menu items (color and icon, "Move to…", delete,
  // import) and the actions without UI (archive, sync now). One host for the
  // whole tree: the root instance mounts it and shares it through context,
  // because a nested instance can unmount mid-action (moving or deleting its
  // last row removes the instance that listed it), and the root never does.
  type DialogsRef = { readonly current: FolderActionDialogs | undefined };
  let ownDialogs = $state<FolderActionDialogs | undefined>(undefined);
  // svelte-ignore state_referenced_locally (depth is fixed per instance)
  const dialogsRef: DialogsRef =
    depth === 0
      ? {
          get current() {
            return ownDialogs;
          }
        }
      : getContext<DialogsRef>(DIALOGS_CONTEXT);
  // svelte-ignore state_referenced_locally (depth is fixed per instance)
  if (depth === 0) setContext(DIALOGS_CONTEXT, dialogsRef);

  function openActionSheet(id: string, e: Event) {
    e.stopPropagation();
    sheetFolderId = id;
    folderActionSheetOpen = true;
  }

  // Keep menuOpenId in sync with the desktop kebab / right-click menu open state
  // so the owning row can hold a background while its menu is open (otherwise the
  // hover is lost the moment the pointer moves onto the menu, and it's unclear
  // which row the menu belongs to).
  function setFolderMenuOpen(id: string, isOpen: boolean) {
    menuOpenId = isOpen ? id : menuOpenId === id ? null : menuOpenId;
  }

  async function handleCreateSub(parentId: string) {
    expandedIds.add(parentId);
    const id = await foldersStore.create($t('folders.new_folder'), parentId);
    pendingRenameId.set(id);
  }

  // A folder's menu. The list itself (items, order, what an undecryptable
  // folder offers) is `buildFolderActions`, shared with the subfolder rows of
  // the main panel and the header of the open folder; this only says what
  // each item does in the tree. The result feeds the desktop kebab, the
  // right-click menu and the phone sheet alike.
  function folderActions(folder: FolderWithChildren, syncConfigId: string | null): RowAction[] {
    // Every item closes the menus first, then acts.
    const act = (fn: () => void) => (e?: Event) => {
      e?.stopPropagation();
      menuOpenId = null;
      folderActionSheetOpen = false;
      fn();
    };
    // Custom sort only: neighbour swaps, hidden at the group's edges.
    const idx = $folderSortMode === 'custom' ? nodes.findIndex((n) => n.id === folder.id) : -1;
    return buildFolderActions(
      folder,
      {
        syncNow: act(() => {
          if (syncConfigId) void dialogsRef.current?.syncNow(syncConfigId);
        }),
        newNote: onnewnote ? act(() => onnewnote?.(folder.id)) : undefined,
        newSubfolder: act(() => void handleCreateSub(folder.id)),
        rename: act(() => startRename(folder)),
        appearance: act(() => dialogsRef.current?.openAppearance(folder)),
        move: act(() => dialogsRef.current?.requestMove(folder)),
        moveUp: idx > 0 ? act(() => void handleNudge(folder, -1)) : undefined,
        moveDown:
          idx !== -1 && idx < nodes.length - 1 ? act(() => void handleNudge(folder, 1)) : undefined,
        importFiles: act(() => dialogsRef.current?.importFiles(folder)),
        importFolder: act(() => dialogsRef.current?.importFolder(folder)),
        // If the folder being browsed is the one archived, the page moves off
        // it (see +page.svelte).
        archive: act(() => void dialogsRef.current?.archive(folder)),
        remove: act(() => dialogsRef.current?.requestDelete(folder))
      },
      { t: $t, syncConfigId }
    );
  }

  // ── Drag & Drop (desktop, HTML5) ────────────────────────────────
  // In the default alphabetical sort, sibling order is derived from names, so
  // a drop on a row only ever means "move dragged folder/note INTO it". In
  // custom sort the row splits into three vertical bands: the outer quarters
  // insert the dragged FOLDER before/after the row (reorder), the middle keeps
  // meaning "into". Moving a folder to the TOP level goes through the panel's
  // root drop zone (+page.svelte), a between-rows drop at depth 0, or the
  // "Move to…" picker.

  function onDragStart(folder: FolderWithChildren, e: DragEvent) {
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', folder.id);
    e.dataTransfer!.setData('text/folder-id', folder.id);
    // The dragged node lives in THIS instance, so its subtree is known here:
    // publish it for all instances to refuse cycle-creating drops.
    dragBlockedIds.set(new Set(getDescendantFolderIds([folder], folder.id)));
  }

  function onDragEnd() {
    dragBlockedIds.set(null);
  }

  // Which band of a row the pointer is in - shared by the desktop dragover
  // and the touch drag. Reorder bands exist only in custom sort.
  function zoneForPoint(rect: DOMRect, clientY: number): DropZone {
    if ($folderSortMode !== 'custom') return 'into';
    const y = clientY - rect.top;
    if (y < rect.height * 0.25) return 'before';
    if (y > rect.height * 0.75) return 'after';
    return 'into';
  }

  function dropZoneFromEvent(e: DragEvent): DropZone {
    // Notes have no sibling order among folders - they always move INTO.
    if (e.dataTransfer!.types.includes('text/note-id')) return 'into';
    return zoneForPoint((e.currentTarget as HTMLElement).getBoundingClientRect(), e.clientY);
  }

  // The bottom band of an EXPANDED folder's row visually points at the slot
  // before its first child, so make the semantics match the picture
  // (Finder-style): retarget to that child. Without this the same 1-2 px gap
  // hides two different levels ("after the whole subtree" vs "first inside"),
  // and "after the subtree" reads as a no-op when the dragged row already sits
  // there. Inserting after the subtree instead = drop before the next row
  // below it (the line indent shows the level).
  function normalizeRowZone(targetId: string, zone: DropZone): { id: string; zone: DropZone } {
    if (zone === 'after' && expandedIds.has(targetId)) {
      const firstChild = findChildrenOfParent($foldersStore, targetId)[0];
      // A blocked first child means it's the dragged row itself - keep the
      // raw meaning then, it's the only way to drag a first child out to
      // "right after its parent".
      if (firstChild && !$dragBlockedIds?.has(firstChild.id)) {
        return { id: firstChild.id, zone: 'before' };
      }
    }
    return { id: targetId, zone };
  }

  function onDragOver(folder: FolderWithChildren, e: DragEvent) {
    // No preventDefault for the dragged folder's own subtree - the browser
    // keeps the no-drop cursor and never fires drop there.
    if ($dragBlockedIds?.has(folder.id)) {
      dropTarget.set(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dropTarget.set(normalizeRowZone(folder.id, dropZoneFromEvent(e)));
  }

  function onDragLeave(folder: FolderWithChildren) {
    // Only clear our own indicator - dragenter on the next row may already
    // have written to the shared store before this leave fires.
    dropTarget.update((t) => (t?.id === folder.id ? null : t));
  }

  // Place `draggedId` before/after `targetId` inside the sibling group under
  // `groupParentId`. A cross-parent drag reparents first (move() appends at
  // the group's end), then the whole group's order_index is rewritten.
  // Shared by the desktop between-rows drop and the touch drop.
  async function insertIntoGroup(
    draggedId: string,
    targetId: string,
    zone: 'before' | 'after',
    groupParentId: string | null,
    siblingIds: string[]
  ) {
    const ids = siblingIds.filter((id) => id !== draggedId);
    const targetIdx = ids.indexOf(targetId);
    if (targetIdx === -1) return;
    ids.splice(zone === 'after' ? targetIdx + 1 : targetIdx, 0, draggedId);
    if (!siblingIds.includes(draggedId)) {
      await foldersStore.move(draggedId, groupParentId);
    }
    await foldersStore.reorder(groupParentId, ids);
  }

  // Place `draggedId` before/after the row `targetRowId`, wherever that row's
  // sibling group lives in the tree (normalizeRowZone may have retargeted the
  // indicator outside this instance's group, and the touch gesture can drop
  // on any row). Shared by the desktop drop and the touch drop.
  async function insertRelativeToRow(
    draggedId: string,
    targetRowId: string,
    zone: 'before' | 'after',
    blocked: Set<string> | null
  ) {
    const located = findParentAndSiblings($foldersStore, targetRowId);
    if (!located) return;
    // Target group hanging inside the dragged subtree would cycle.
    if (located.parentId && blocked?.has(located.parentId)) return;
    await insertIntoGroup(
      draggedId,
      targetRowId,
      zone,
      located.parentId,
      located.siblings.map((f) => f.id)
    );
  }

  async function onDrop(target: FolderWithChildren, e: DragEvent) {
    e.preventDefault();
    e.stopPropagation(); // prevent bubbling to the panel's root drop zone
    // The indicator is authoritative: normalizeRowZone may have retargeted it
    // to the first child while the drop event still fires on the hovered row.
    const indicated = $dropTarget;

    try {
      // Handle note drop - move note into this folder
      const noteId = e.dataTransfer!.getData('text/note-id');
      if (noteId) {
        await notesStore.move(noteId, target.id);
        return;
      }

      const draggedId =
        e.dataTransfer!.getData('text/folder-id') || e.dataTransfer!.getData('text/plain');
      const eff = indicated ?? { id: target.id, zone: 'into' as DropZone };
      if (!draggedId || draggedId === eff.id) return;
      // Cycle guard (dragover already refuses these; keep drop safe too).
      if ($dragBlockedIds?.has(eff.id)) return;

      if (eff.zone === 'into') {
        // Move dragged folder into target
        await foldersStore.move(draggedId, eff.id);
        expandedIds.add(eff.id);
      } else {
        await insertRelativeToRow(draggedId, eff.id, eff.zone, $dragBlockedIds);
      }
    } catch {
      // Dragged row or drop target deleted remotely mid-gesture - surface it
      // instead of an unhandled rejection, refresh to drop the stale row
      // (audit 013 O56).
      toastStore.error($t('folders.move_failed_missing'));
      foldersStore.refresh();
    } finally {
      dropTarget.set(null);
      dragBlockedIds.set(null);
    }
  }

  // ── Move up / move down (custom sort only) ──────────────────────
  // Keyboard- and touch-reachable counterpart of drag-between-rows: swap the
  // folder with its neighbour in this sibling group.
  async function handleNudge(folder: FolderWithChildren, dir: -1 | 1) {
    const ids = nodes.map((n) => n.id);
    const i = ids.indexOf(folder.id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await foldersStore.reorder(parentId, ids);
  }

  // ── Touch drag (long-press) ──────────────────────────────────────
  // HTML5 DnD doesn't exist on touch, so rows implement their own pointer
  // gesture with the same semantics as the desktop drag: hold a row for
  // 300 ms (moving earlier scrolls instead), a clone of the row follows the
  // finger, hovered rows show the desktop indicators (ring = into, insertion
  // line = reorder in custom sort), and dwelling over a collapsed folder
  // spring-loads it open so the drop can land inside it. Mouse pointers keep
  // the native HTML5 path; the gesture is limited to mobile viewports, where
  // the long-press ContextMenu is disabled (tablets keep their ContextMenu).
  // The instance where the press starts owns the whole gesture (window
  // listeners); cross-instance state flows through the module stores, and the
  // drop resolves the target's sibling group from the full store tree.
  const LONG_PRESS_MS = 300;
  const PRE_ARM_SLOP_PX = 8;
  const SPRING_LOAD_MS = 600;
  const EDGE_SCROLL_ZONE_PX = 56;
  const EDGE_SCROLL_MAX_PX_PER_FRAME = 12;

  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressFolder: FolderWithChildren | null = null;
  let pressPointerId = -1;
  let pressStart = { x: 0, y: 0 };
  let pointerX = 0;
  let pointerY = 0;
  let touchDragging = false;
  let dragRowEl: HTMLElement | null = null;
  let cloneEl: HTMLElement | null = null;
  let springTimer: ReturnType<typeof setTimeout> | null = null;
  let springTargetId: string | null = null;
  let scrollContainer: HTMLElement | null = null;
  let scrollRaf = 0;

  function onRowPointerDown(folder: FolderWithChildren, e: PointerEvent) {
    if (e.pointerType === 'mouse' || !isMobileQuery.value) return;
    if (editingId === folder.id) return;
    // Chevron / kebab / rename input own their taps - no drag from controls.
    if ((e.target as HTMLElement).closest('button, input')) return;
    if (pressTimer || touchDragging) return; // second finger while active
    // Cross-instance latch: a press at another tree depth is a separate
    // component instance - the guards above can't see it (audit 013 N3).
    if (!claimTouchGesture()) return;
    pressFolder = folder;
    pressPointerId = e.pointerId;
    pressStart = { x: e.clientX, y: e.clientY };
    pointerX = e.clientX;
    pointerY = e.clientY;
    dragRowEl = e.currentTarget as HTMLElement;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    pressTimer = setTimeout(startTouchDrag, LONG_PRESS_MS);
  }

  function startTouchDrag() {
    pressTimer = null;
    const folder = pressFolder;
    const rowEl = dragRowEl;
    if (!folder || !rowEl || !rowEl.isConnected) {
      cancelPress();
      return;
    }
    touchDragging = true;
    // Same cycle guard as the desktop drag: the dragged subtree can't be a target.
    dragBlockedIds.set(new Set(getDescendantFolderIds([folder], folder.id)));
    touchDraggingId.set(folder.id);
    if ('vibrate' in navigator) navigator.vibrate(50);
    // pointermove alone can't stop native scrolling - block touchmove for the
    // rest of the gesture (the pre-arm phase deliberately leaves it free).
    window.addEventListener('touchmove', blockScroll, { passive: false });
    // Holding still past the OS threshold must not pop selection/context UI.
    window.addEventListener('contextmenu', blockEvent, true);
    makeClone(rowEl);
    scrollContainer = findScrollParent(rowEl);
    scrollRaf = requestAnimationFrame(edgeScrollLoop);
    updateTouchDropTarget();
  }

  function blockScroll(e: TouchEvent) {
    e.preventDefault();
  }

  function blockEvent(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  function makeClone(rowEl: HTMLElement) {
    const rect = rowEl.getBoundingClientRect();
    const clone = rowEl.cloneNode(true) as HTMLElement;
    clone.classList.add('bg-background');
    clone.style.pointerEvents = 'none';
    clone.style.position = 'fixed';
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.margin = '0';
    clone.style.zIndex = '9999';
    clone.style.opacity = '0.92';
    clone.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.18)';
    clone.style.willChange = 'transform';
    document.body.appendChild(clone);
    cloneEl = clone;
    positionClone();
  }

  function positionClone() {
    if (!cloneEl) return;
    cloneEl.style.transform = `translate3d(${pointerX - pressStart.x}px, ${pointerY - pressStart.y}px, 0)`;
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId !== pressPointerId) return;
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (!touchDragging) {
      // Finger moved before the hold elapsed - it's a scroll, not a drag.
      if (
        Math.abs(pointerX - pressStart.x) >= PRE_ARM_SLOP_PX ||
        Math.abs(pointerY - pressStart.y) >= PRE_ARM_SLOP_PX
      ) {
        cancelPress();
      }
      return;
    }
    positionClone();
    updateTouchDropTarget();
  }

  function updateTouchDropTarget() {
    // The clone has pointer-events: none, so it never shadows the hit test.
    const el = document.elementFromPoint(pointerX, pointerY);
    const rowEl = el?.closest<HTMLElement>('[data-folder-id]') ?? null;
    const targetId = rowEl?.getAttribute('data-folder-id');
    if (!rowEl || !targetId || targetId === pressFolder?.id || $dragBlockedIds?.has(targetId)) {
      dropTarget.set(null);
      setSpringTarget(null);
      return;
    }
    const zone = zoneForPoint(rowEl.getBoundingClientRect(), pointerY);
    const normalized = normalizeRowZone(targetId, zone);
    dropTarget.set(normalized);
    setSpringTarget(zone === 'into' ? targetId : null);
  }

  // Dwelling over a collapsed folder opens it mid-drag, so the drop can land
  // between its (now visible) children or on them. Freshly revealed rows are
  // immediately valid targets - the hit test reads the live DOM.
  function setSpringTarget(id: string | null) {
    if (id === springTargetId) return;
    if (springTimer) {
      clearTimeout(springTimer);
      springTimer = null;
    }
    springTargetId = id;
    if (!id || expandedIds.has(id)) return;
    const hasContent =
      findChildrenOfParent($foldersStore, id).length > 0 ||
      (savedSearchesByFolder?.get(id)?.length ?? 0) > 0;
    if (!hasContent) return;
    springTimer = setTimeout(() => {
      springTimer = null;
      if (touchDragging && springTargetId === id) expandedIds.add(id);
    }, SPRING_LOAD_MS);
  }

  function findScrollParent(el: HTMLElement): HTMLElement | null {
    let cur: HTMLElement | null = el.parentElement;
    while (cur) {
      const style = getComputedStyle(cur);
      if (/(auto|scroll)/.test(style.overflowY) && cur.scrollHeight > cur.clientHeight) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // Keeps scrolling while the finger dwells in the container's edge zones
  // (pointermove stops firing for a stationary finger, hence the rAF loop).
  function edgeScrollLoop() {
    if (!touchDragging) return;
    if (scrollContainer) {
      const rect = scrollContainer.getBoundingClientRect();
      let delta = 0;
      if (pointerY < rect.top + EDGE_SCROLL_ZONE_PX) {
        const intensity = (rect.top + EDGE_SCROLL_ZONE_PX - pointerY) / EDGE_SCROLL_ZONE_PX;
        delta = -Math.ceil(intensity * EDGE_SCROLL_MAX_PX_PER_FRAME);
      } else if (pointerY > rect.bottom - EDGE_SCROLL_ZONE_PX) {
        const intensity = (pointerY - (rect.bottom - EDGE_SCROLL_ZONE_PX)) / EDGE_SCROLL_ZONE_PX;
        delta = Math.ceil(intensity * EDGE_SCROLL_MAX_PX_PER_FRAME);
      }
      if (delta !== 0) {
        const before = scrollContainer.scrollTop;
        scrollContainer.scrollTop = before + delta;
        if (scrollContainer.scrollTop !== before) updateTouchDropTarget();
      }
    }
    scrollRaf = requestAnimationFrame(edgeScrollLoop);
  }

  async function onPointerUp(e: PointerEvent) {
    if (e.pointerId !== pressPointerId) return;
    if (!touchDragging) {
      cancelPress(); // plain tap - the native click still selects the row
      return;
    }
    const dragged = pressFolder;
    const target = $dropTarget;
    const blocked = $dragBlockedIds;
    teardownTouchDrag();
    if (!dragged || !target || target.id === dragged.id) return;
    // A release without movement still produces a click on the row - swallow
    // it so dropping doesn't also open the folder.
    suppressNextClick();
    try {
      if (target.zone === 'into') {
        if (blocked?.has(target.id)) return;
        await foldersStore.move(dragged.id, target.id);
        expandedIds.add(target.id);
      } else {
        await insertRelativeToRow(dragged.id, target.id, target.zone, blocked);
      }
    } catch {
      // Same stale-target handling as the desktop onDrop (audit 013 O56).
      toastStore.error($t('folders.move_failed_missing'));
      foldersStore.refresh();
    }
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerId !== pressPointerId) return;
    if (touchDragging) teardownTouchDrag();
    else cancelPress();
  }

  function suppressNextClick() {
    const squelch = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', squelch, { capture: true, once: true });
    // If no click follows (finger moved during the drag), don't let the
    // squelch linger and eat the next genuine tap.
    setTimeout(() => window.removeEventListener('click', squelch, { capture: true }), 400);
  }

  function cancelPress() {
    // Release the cross-instance latch only when this instance owns a gesture
    // (pressFolder set) - the unmount cleanup below calls cancelPress on every
    // instance, and an unconditional release would free a latch held by the
    // still-running gesture of another instance.
    if (pressFolder) releaseTouchGesture();
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressFolder = null;
    pressPointerId = -1;
    dragRowEl = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function teardownTouchDrag() {
    touchDragging = false;
    if (springTimer) {
      clearTimeout(springTimer);
      springTimer = null;
    }
    springTargetId = null;
    if (scrollRaf) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    }
    scrollContainer = null;
    cloneEl?.remove();
    cloneEl = null;
    dropTarget.set(null);
    dragBlockedIds.set(null);
    touchDraggingId.set(null);
    window.removeEventListener('touchmove', blockScroll);
    window.removeEventListener('contextmenu', blockEvent, true);
    cancelPress();
  }

  // The gesture owner may unmount mid-drag (remote sync can drop this
  // subtree) - its window listeners and clone must not outlive it.
  $effect(() => {
    return () => {
      if (touchDragging) teardownTouchDrag();
      else cancelPress();
    };
  });
</script>

<!-- Close menus when clicking outside -->
<svelte:window
  onclick={() => {
    menuOpenId = null;
  }}
/>

<ul class="select-none" role="tree">
  {#if showDraft}
    <li role="treeitem" aria-selected="false">
      <div
        class="group relative flex items-center gap-1.5 rounded-md px-2 py-2.5 text-sm bg-accent/30"
        style="padding-inline-start: {depth * 0.75 + 0.5}rem"
      >
        <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          {@attach registerNewFolderDraftInput}
          bind:value={draftName}
          class="min-w-0 flex-1 rounded-md border bg-background px-2 py-0.5 text-sm caret-primary focus:outline-none focus:ring-1 focus:ring-primary"
          onkeydown={(e) => {
            if (e.key === 'Enter') commitDraft();
            if (e.key === 'Escape') cancelDraft();
          }}
          onblur={commitDraft}
          aria-label={$t('folders.new_folder')}
        />
      </div>
    </li>
  {/if}
  <!-- Top-level smart folders (root-pinned saved searches) render above the folder
       list. Root instance only; not a drop target (a leaf, not a real folder). -->
  {#if depth === 0 && rootPinnedSearches && rootPinnedSearches.length > 0}
    {#each rootPinnedSearches as search (search.id)}
      <SavedSearchRow
        {search}
        context="tree"
        depth={0}
        active={search.id === activeSavedSearchId}
        onselect={(s) => onsavedsearchselect?.(s)}
      />
    {/each}
  {/if}
  {#each nodes as folder (folder.id)}
    {@const isExpanded = expandedIds.has(folder.id)}
    {@const isActive = activeFolderId === folder.id}
    {@const parkedSearches = savedSearchesByFolder?.get(folder.id) ?? []}
    {@const hasChildren = (folder.children?.length ?? 0) > 0 || parkedSearches.length > 0}
    {@const dropZone = $dropTarget?.id === folder.id ? $dropTarget.zone : null}
    {@const syncConfigId = $syncedFolderConfigs.get(folder.id) ?? null}
    {@const hasCustomIcon = isFolderIcon(folder.icon)}
    {@const rowActions = folderActions(folder, syncConfigId)}

    <li
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={activeFolderId === folder.id}
      animate:flip={{ duration: 200 }}
    >
      <!-- Desktop right-click opens the same folder actions as the kebab (#348).
           Disabled on mobile and while renaming inline. -->
      <ContextMenu onOpenChange={(o) => setFolderMenuOpen(folder.id, o)}>
        <ContextMenuTrigger disabled={isMobileQuery.value || editingId === folder.id}>
          {#snippet child({ props: triggerProps })}
            <div
              {...triggerProps}
              data-folder-id={folder.id}
              draggable="true"
              ondragstart={(e) => onDragStart(folder, e)}
              ondragend={onDragEnd}
              ondragover={(e) => onDragOver(folder, e)}
              ondragleave={() => onDragLeave(folder)}
              ondrop={(e) => onDrop(folder, e)}
              onpointerdown={(e) => onRowPointerDown(folder, e)}
              class="group relative flex items-center gap-1.5 rounded-md px-2 py-2.5 text-sm
                cursor-pointer transition-colors
                {isActive
                ? 'list-row-active text-accent-foreground font-medium'
                : menuOpenId === folder.id || (folderActionSheetOpen && sheetFolderId === folder.id)
                  ? 'bg-accent/50 text-foreground'
                  : 'text-foreground hover:bg-accent/50'}
                {dropZone === 'into' ? 'ring-1 ring-primary bg-accent/30' : ''}
                {$touchDraggingId === folder.id ? 'opacity-50' : ''}"
              style="padding-inline-start: {depth * 0.75 + 0.5}rem"
              role="button"
              tabindex="0"
              onclick={() => handleRowSelect(folder)}
              onkeydown={(e) => e.key === 'Enter' && handleRowSelect(folder)}
              aria-label={$t('folders.folder_label', { values: { name: folderDisplayName(folder) } })}
              title={folder.decrypt_failed ? $t('folders.undecryptable_hint') : undefined}
            >
              <!-- Custom sort: insertion line for a between-rows drop. Starts
                   at the row's own indent so the target LEVEL is visible
                   (a gap between a nested row and a shallower one offers two
                   valid levels - the indent says which one this drop takes). -->
              {#if dropZone === 'before' || dropZone === 'after'}
                <div
                  class="pointer-events-none absolute inset-e-1 z-10 h-0.5 rounded-full bg-primary
                    {dropZone === 'before' ? 'top-0' : 'bottom-0'}"
                  style="inset-inline-start: {depth * 0.75 + 0.5}rem"
                ></div>
              {/if}
              <!-- Folder icon in its chosen color. A synced folder keeps the
                   sync glyph unless the user picked an icon - then the icon
                   wins and a small sync marker follows the name instead. -->
              {#if syncConfigId && !hasCustomIcon}
                <FolderSync
                  class="h-4 w-4 shrink-0 {appearanceTextClass(folder.color) ?? 'text-primary'}"
                  aria-label={$t('folders.synced_folder')}
                />
              {:else}
                <FolderGlyph
                  color={folder.color}
                  icon={folder.icon}
                  open={isExpanded && hasChildren}
                />
              {/if}

              <!-- Name / inline rename -->
              {#if editingId === folder.id}
                <input
                  bind:this={editInputEl}
                  bind:value={editingName}
                  class="min-w-0 flex-1 rounded-md border bg-background px-2 py-0.5 text-sm caret-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') commitRename(folder.id);
                    if (e.key === 'Escape') cancelRename();
                  }}
                  onblur={() => commitRename(folder.id)}
                />
              {:else if folder.decrypt_failed}
                <span class="min-w-0 flex-1 truncate italic text-muted-foreground"
                  >{folderDisplayName(folder)}</span
                >
              {:else}
                <span class="min-w-0 flex-1 truncate"><bdi>{folder.name}</bdi></span>
              {/if}

              {#if syncConfigId && hasCustomIcon && editingId !== folder.id}
                <span class="flex shrink-0" title={$t('folders.synced_folder')}>
                  <RefreshCw
                    class="h-3 w-3 text-muted-foreground"
                    role="img"
                    aria-label={$t('folders.synced_folder')}
                  />
                </span>
              {/if}

              <!-- Chevron (right side, only when has children) -->
              {#if hasChildren && editingId !== folder.id}
                <button
                  type="button"
                  onclick={(e) => {
                    e.stopPropagation();
                    if (isExpanded) expandedIds.delete(folder.id);
                    else expandedIds.add(folder.id);
                  }}
                  class="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label={isExpanded ? $t('folders.collapse') : $t('folders.expand')}
                  tabindex="-1"
                >
                  <ChevronRight
                    class="h-3.5 w-3.5 transition-transform {isExpanded ? 'rotate-90 rtl:-rotate-90' : ''}"
                  />
                </button>
              {/if}

              <!-- Kebab menu button (visible on hover) -->
              {#if editingId !== folder.id}
                {#if isMobileQuery.value}
                  <button
                    type="button"
                    onclick={(e) => openActionSheet(folder.id, e)}
                    class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={$t('folders.folder_actions')}
                    tabindex="-1"
                  >
                    <MoreHorizontal class="h-3.5 w-3.5" />
                  </button>
                {:else}
                  <DropdownMenu onOpenChange={(o) => setFolderMenuOpen(folder.id, o)}>
                    <DropdownMenuTrigger>
                      {#snippet child({ props })}
                        <button
                          {...props}
                          type="button"
                          onclick={(e) => e.stopPropagation()}
                          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:bg-accent hover:text-foreground"
                          aria-label={$t('folders.folder_actions')}
                          tabindex="-1"
                        >
                          <MoreHorizontal class="h-3.5 w-3.5" />
                        </button>
                      {/snippet}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="min-w-36">
                      {#each rowActions as { key, icon: Icon, label, run, destructive, separatorBefore } (key)}
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
                {/if}
              {/if}
            </div>
          {/snippet}
        </ContextMenuTrigger>
        {#if !isMobileQuery.value && editingId !== folder.id}
          <ContextMenuContent class="min-w-44">
            {#each rowActions as { key, icon: Icon, label, run, destructive, separatorBefore } (key)}
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

      <!-- Saved searches parked in this folder render ABOVE its subfolders -
           same "searches before folders" rule as root-pin and the folder
           drill-down view, and keeps a parked search visible without scrolling
           past a deep subtree. -->
      {#if isExpanded && hasChildren}
        {#if parkedSearches.length > 0}
          <ul class="select-none" role="group">
            {#each parkedSearches as search (search.id)}
              <SavedSearchRow
                {search}
                context="tree"
                depth={depth + 1}
                active={search.id === activeSavedSearchId}
                onselect={(s) => onsavedsearchselect?.(s)}
              />
            {/each}
          </ul>
        {/if}
        {#if (folder.children?.length ?? 0) > 0}
          <FolderTree
            nodes={folder.children ?? []}
            depth={depth + 1}
            parentId={folder.id}
            {activeFolderId}
            {activeSavedSearchId}
            {expandedIds}
            {onselect}
            {onnewnote}
            {savedSearchesByFolder}
            {onsavedsearchselect}
          />
        {/if}
      {/if}
    </li>
  {/each}
</ul>

<!-- Phone: folder action sheet - the same list as the desktop menus. -->
{#if isMobileQuery.value}
  <RowActionSheet
    bind:open={folderActionSheetOpen}
    title={sheetFolder ? folderDisplayName(sheetFolder) : ''}
    hint={sheetFolder?.decrypt_failed ? $t('folders.undecryptable_hint') : undefined}
    actions={sheetFolder
      ? folderActions(sheetFolder, $syncedFolderConfigs.get(sheetFolder.id) ?? null)
      : []}
  />
{/if}

<!-- Dialogs behind the menu items - one host for the whole tree (see the
     script). A move reveals the new location, mirroring the drag&drop path. -->
{#if depth === 0}
  <FolderActionDialogs
    bind:this={ownDialogs}
    onAfterMove={(_folder, targetId) => {
      if (targetId) expandedIds.add(targetId);
    }}
  />
{/if}
