<script module>
  import { writable } from 'svelte/store';
  // Shared across all FolderTree instances (including recursive children).
  // Set to a folder ID to immediately enter rename mode for that folder.
  export const pendingRenameId = writable<string | null>(null);
</script>

<script lang="ts">
  import {
    ChevronRight,
    Folder,
    FolderOpen,
    FolderSync,
    FolderInput,
    MoreHorizontal,
    FolderPlus,
    FilePlus,
    Pencil,
    RefreshCw,
    Trash2,
    Upload
  } from '@lucide/svelte';
  import {
    Button,
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
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    toastStore
  } from '@reborn/ui';
  import type { RowAction } from '$lib/utils/row-action';
  import { syncedFolderConfigs, runFolderSync } from '$lib/services/folder-sync.service';
  import type { FolderWithChildren, SavedSearchDecrypted } from '@reborn/types';
  import { foldersStore } from '$lib/stores/folders.store';
  import { notesStore } from '$lib/stores/notes.store';
  import { pendingNewFolderDraft } from '$lib/stores/new-folder-draft.store';
  import { t } from '$lib/stores/i18n.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import type { DeleteFolderMode } from '$lib/services/folder.service';
  import DeleteFolderDialog from './DeleteFolderDialog.svelte';
  import ImportMarkdownToFolderDialog from '$lib/components/import/ImportMarkdownToFolderDialog.svelte';
  import SavedSearchRow from '$lib/components/notes/SavedSearchRow.svelte';
  import FolderTree from './FolderTree.svelte';

  let {
    nodes,
    depth = 0,
    activeFolderId = null,
    expandedIds,
    onselect,
    onnewnote = undefined,
    savedSearchesByFolder = undefined,
    onsavedsearchselect = undefined
  }: {
    nodes: FolderWithChildren[];
    depth?: number;
    activeFolderId?: string | null;
    expandedIds: Set<string>;
    onselect: (id: string | null) => void;
    /** Create a new note inside the folder (parent owns the create + navigate). */
    onnewnote?: (folderId: string) => void;
    /** Saved searches parked per folder id - rendered as leaf nodes under the folder. */
    savedSearchesByFolder?: Map<string, SavedSearchDecrypted[]>;
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
      pendingRenameId.set(null); // claim — clear so sibling instances don't also trigger
      editingId = pendingId;
      editingName = found.name;
      setTimeout(() => editInputEl?.select(), 0);
    }
  });

  // ── Inline new-folder draft (root list only) ───────────────────
  // When `pendingNewFolderDraft.parentId === null`, the root FolderTree
  // (depth 0) renders an input row at the very top. Folder is created on
  // commit, not when the draft is requested.
  let draftName = $state('');
  let draftInputEl = $state<HTMLInputElement | undefined>(undefined);
  const showDraft = $derived(depth === 0 && $pendingNewFolderDraft?.parentId === null);

  $effect(() => {
    if (showDraft) {
      draftName = $t('folders.new_folder');
      setTimeout(() => {
        draftInputEl?.scrollIntoView({ block: 'nearest' });
        draftInputEl?.select();
      }, 0);
    }
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

  function startRename(folder: FolderWithChildren, e?: Event) {
    e?.stopPropagation();
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

  // ── Context menu (kebab) ────────────────────────────────────────
  const isMobileQuery = useIsMobile();
  let menuOpenId = $state<string | null>(null);
  let folderActionSheetOpen = $state(false);
  let deleteFolderDialogOpen = $state(false);
  let folderToDelete = $state<FolderWithChildren | null>(null);

  const activeMenuFolder = $derived(
    menuOpenId ? (nodes.find((n) => n.id === menuOpenId) ?? null) : null
  );

  // ── Folder sync ─────────────────────────────────────────────────
  // The sync link is by folder id, so the marker follows renames and needs no
  // top-level/name gate (ids are unique). The mobile sheet reads it for the
  // active folder; the desktop dropdown reads its per-row `syncConfigId`.
  const activeMenuSyncId = $derived(
    activeMenuFolder ? ($syncedFolderConfigs.get(activeMenuFolder.id) ?? null) : null
  );
  let syncingId = $state<string | null>(null);

  async function handleSyncNow(configId: string, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    folderActionSheetOpen = false;
    if (syncingId) return;
    syncingId = configId;
    try {
      await runFolderSync('manual', configId);
      toastStore.success($t('folders.sync_done'));
    } finally {
      syncingId = null;
    }
  }

  function toggleMenu(id: string, e: Event) {
    e.stopPropagation();
    if (isMobileQuery.value) {
      menuOpenId = id;
      folderActionSheetOpen = true;
    } else {
      menuOpenId = menuOpenId === id ? null : id;
    }
  }

  function handleCreateNote(folderId: string, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    folderActionSheetOpen = false;
    onnewnote?.(folderId);
  }

  async function handleCreateSub(parentId: string, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    folderActionSheetOpen = false;
    expandedIds.add(parentId);
    const id = await foldersStore.create($t('folders.new_folder'), parentId);
    pendingRenameId.set(id);
  }

  function handleStartRename(folder: FolderWithChildren, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    folderActionSheetOpen = false;
    startRename(folder);
  }

  function handleDelete(folder: FolderWithChildren, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    folderActionSheetOpen = false;
    folderToDelete = folder;
    deleteFolderDialogOpen = true;
  }

  async function confirmDeleteFolder(mode: DeleteFolderMode) {
    if (folderToDelete) {
      await foldersStore.remove(folderToDelete.id, mode);
      // Cascade soft-deletes notes — refresh the visible note list so they
      // disappear from the current folder/All-notes view immediately.
      if (mode === 'cascade') notesStore.refresh();
    }
    folderToDelete = null;
  }

  // ── Import .md files / folder tree to folder ────────────────────
  let importDialogOpen = $state(false);
  let importMode = $state<'files' | 'folder'>('files');
  let importTargetFolder = $state<FolderWithChildren | null>(null);
  let importPendingFiles = $state<File[] | null>(null);
  let importFileInputEl = $state<HTMLInputElement | null>(null);
  let importFolderInputEl = $state<HTMLInputElement | null>(null);

  function handleImportHere(folder: FolderWithChildren, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    folderActionSheetOpen = false;
    importMode = 'files';
    importTargetFolder = folder;
    // Reset value so re-selecting the same files re-fires `change`.
    if (importFileInputEl) importFileInputEl.value = '';
    importFileInputEl?.click();
  }

  function handleImportFolderHere(folder: FolderWithChildren, e?: Event) {
    e?.stopPropagation();
    menuOpenId = null;
    folderActionSheetOpen = false;
    importMode = 'folder';
    importTargetFolder = folder;
    if (importFolderInputEl) importFolderInputEl.value = '';
    importFolderInputEl?.click();
  }

  // Shared by both hidden inputs - `importMode` was set by the trigger.
  function handleImportFilesSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0 || !importTargetFolder) {
      importTargetFolder = null;
      return;
    }
    importPendingFiles = files;
    importDialogOpen = true;
  }

  $effect(() => {
    // When dialog closes, drop the file/folder context (parent of source of truth).
    if (!importDialogOpen) {
      importPendingFiles = null;
      importTargetFolder = null;
    }
  });

  // Single source of truth for a folder's actions — fed to both the desktop kebab
  // (DropdownMenu) and the desktop right-click ContextMenu, so they can't drift.
  function folderActions(folder: FolderWithChildren, syncConfigId: string | null): RowAction[] {
    const actions: RowAction[] = [];
    if (syncConfigId) {
      actions.push({
        key: 'sync',
        icon: RefreshCw,
        label: $t('folders.sync_now'),
        run: (e) => handleSyncNow(syncConfigId, e)
      });
    }
    if (onnewnote) {
      actions.push({
        key: 'new-note',
        icon: FilePlus,
        label: $t('folders.new_note_here'),
        run: (e) => handleCreateNote(folder.id, e),
        separatorBefore: !!syncConfigId
      });
    }
    actions.push(
      {
        key: 'new-subfolder',
        icon: FolderPlus,
        label: $t('folders.new_subfolder'),
        run: (e) => handleCreateSub(folder.id, e),
        separatorBefore: !!syncConfigId && !onnewnote
      },
      {
        key: 'rename',
        icon: Pencil,
        label: $t('folders.rename'),
        run: (e) => startRename(folder, e)
      },
      {
        key: 'import-md',
        icon: Upload,
        label: $t('folders.import_markdown.action'),
        run: (e) => handleImportHere(folder, e)
      },
      {
        key: 'import-folder',
        icon: FolderInput,
        label: $t('folders.import_folder.action'),
        run: (e) => handleImportFolderHere(folder, e)
      },
      {
        key: 'delete',
        icon: Trash2,
        label: $t('folders.delete_folder'),
        run: (e) => handleDelete(folder, e),
        destructive: true,
        separatorBefore: true
      }
    );
    return actions;
  }

  // ── Drag & Drop ─────────────────────────────────────────────────
  // Folder rows are sorted alphabetically (see folder.service.getFolderTree),
  // so sibling reorder is meaningless — drop on a row only ever means
  // "move dragged folder/note INTO this folder".
  let dragOverId = $state<string | null>(null);

  function onDragStart(folder: FolderWithChildren, e: DragEvent) {
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', folder.id);
    e.dataTransfer!.setData('text/folder-id', folder.id);
  }

  function onDragOver(folder: FolderWithChildren, e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOverId = folder.id;
  }

  function onDragLeave() {
    dragOverId = null;
  }

  async function onDrop(target: FolderWithChildren, e: DragEvent) {
    e.preventDefault();
    e.stopPropagation(); // prevent bubbling to AppSidebar root handler

    // Handle note drop — move note into this folder
    const noteId = e.dataTransfer!.getData('text/note-id');
    if (noteId) {
      await notesStore.move(noteId, target.id);
      dragOverId = null;
      return;
    }

    const draggedId =
      e.dataTransfer!.getData('text/folder-id') || e.dataTransfer!.getData('text/plain');
    if (!draggedId || draggedId === target.id) {
      dragOverId = null;
      return;
    }

    // Move dragged folder into target
    await foldersStore.move(draggedId, target.id);
    expandedIds.add(target.id);

    dragOverId = null;
  }
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
        style="padding-left: {depth * 0.75 + 0.5}rem"
      >
        <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          bind:this={draftInputEl}
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
  {#each nodes as folder (folder.id)}
    {@const isExpanded = expandedIds.has(folder.id)}
    {@const isActive = activeFolderId === folder.id}
    {@const parkedSearches = savedSearchesByFolder?.get(folder.id) ?? []}
    {@const hasChildren = (folder.children?.length ?? 0) > 0 || parkedSearches.length > 0}
    {@const isDragTarget = dragOverId === folder.id}
    {@const syncConfigId = $syncedFolderConfigs.get(folder.id) ?? null}
    {@const rowActions = folderActions(folder, syncConfigId)}

    <li
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={activeFolderId === folder.id}
    >
      <!-- Desktop right-click opens the same folder actions as the kebab (#348).
           Disabled on mobile and while renaming inline. -->
      <ContextMenu>
        <ContextMenuTrigger disabled={isMobileQuery.value || editingId === folder.id}>
          {#snippet child({ props: triggerProps })}
            <div
              {...triggerProps}
              data-folder-id={folder.id}
              draggable="true"
              ondragstart={(e) => onDragStart(folder, e)}
              ondragover={(e) => onDragOver(folder, e)}
              ondragleave={onDragLeave}
              ondrop={(e) => onDrop(folder, e)}
              class="group relative flex items-center gap-1.5 rounded-md px-2 py-2.5 text-sm
                cursor-pointer transition-colors
                {isActive
                ? 'list-row-active text-accent-foreground font-medium'
                : 'text-foreground hover:bg-accent/50'}
                {isDragTarget ? 'ring-1 ring-primary bg-accent/30' : ''}"
              style="padding-left: {depth * 0.75 + 0.5}rem"
              role="button"
              tabindex="0"
              onclick={() => handleRowSelect(folder)}
              onkeydown={(e) => e.key === 'Enter' && handleRowSelect(folder)}
              aria-label={$t('folders.folder_label', { values: { name: folder.name } })}
            >
              <!-- Folder icon (synced top-level folders get a distinct sync glyph) -->
              {#if syncConfigId}
                <FolderSync
                  class="h-4 w-4 shrink-0 text-primary"
                  aria-label={$t('folders.synced_folder')}
                />
              {:else if isExpanded && hasChildren}
                <FolderOpen class="h-4 w-4 shrink-0 text-muted-foreground" />
              {:else}
                <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
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
              {:else}
                <span class="min-w-0 flex-1 truncate">{folder.name}</span>
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
                    class="h-3.5 w-3.5 transition-transform {isExpanded ? 'rotate-90' : ''}"
                  />
                </button>
              {/if}

              <!-- Kebab menu button (visible on hover) -->
              {#if editingId !== folder.id}
                {#if isMobileQuery.value}
                  <button
                    type="button"
                    onclick={(e) => toggleMenu(folder.id, e)}
                    class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={$t('folders.folder_actions')}
                    tabindex="-1"
                  >
                    <MoreHorizontal class="h-3.5 w-3.5" />
                  </button>
                {:else}
                  <DropdownMenu>
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

      <!-- Children (recursive) + saved searches parked in this folder -->
      {#if isExpanded && hasChildren}
        {#if (folder.children?.length ?? 0) > 0}
          <FolderTree
            nodes={folder.children ?? []}
            depth={depth + 1}
            {activeFolderId}
            {expandedIds}
            {onselect}
            {onnewnote}
            {savedSearchesByFolder}
            {onsavedsearchselect}
          />
        {/if}
        {#if parkedSearches.length > 0}
          <ul class="select-none" role="group">
            {#each parkedSearches as search (search.id)}
              <SavedSearchRow
                {search}
                context="tree"
                depth={depth + 1}
                onselect={(s) => onsavedsearchselect?.(s)}
              />
            {/each}
          </ul>
        {/if}
      {/if}
    </li>
  {/each}
</ul>

<!-- Mobile: Folder action Sheet -->
<Sheet bind:open={folderActionSheetOpen}>
  <SheetContent side="bottom" class="h-auto">
    <SheetHeader>
      <SheetTitle>{activeMenuFolder?.name ?? ''}</SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
      {#if activeMenuSyncId}
        <Button
          variant="ghost"
          class="w-full justify-start"
          onclick={() => activeMenuSyncId && handleSyncNow(activeMenuSyncId)}
        >
          <RefreshCw class="mr-2 h-4 w-4" />
          {$t('folders.sync_now')}
        </Button>
      {/if}
      <Button
        variant="ghost"
        class="w-full justify-start"
        onclick={() => menuOpenId && handleCreateSub(menuOpenId)}
      >
        <FolderPlus class="mr-2 h-4 w-4" />
        {$t('folders.new_subfolder')}
      </Button>
      <Button
        variant="ghost"
        class="w-full justify-start"
        onclick={() => activeMenuFolder && handleStartRename(activeMenuFolder)}
      >
        <Pencil class="mr-2 h-4 w-4" />
        {$t('folders.rename')}
      </Button>
      <Button
        variant="ghost"
        class="w-full justify-start"
        onclick={() => activeMenuFolder && handleImportHere(activeMenuFolder)}
      >
        <Upload class="mr-2 h-4 w-4" />
        {$t('folders.import_markdown.action')}
      </Button>
      <Button
        variant="ghost"
        class="w-full justify-start"
        onclick={() => activeMenuFolder && handleImportFolderHere(activeMenuFolder)}
      >
        <FolderInput class="mr-2 h-4 w-4" />
        {$t('folders.import_folder.action')}
      </Button>
      <Button
        variant="ghost"
        class="w-full justify-start text-destructive hover:text-destructive"
        onclick={() => activeMenuFolder && handleDelete(activeMenuFolder)}
      >
        <Trash2 class="mr-2 h-4 w-4" />
        {$t('folders.delete_folder')}
      </Button>
    </div>
  </SheetContent>
</Sheet>

<DeleteFolderDialog
  bind:open={deleteFolderDialogOpen}
  folderId={folderToDelete?.id ?? null}
  folderName={folderToDelete?.name ?? ''}
  onConfirm={confirmDeleteFolder}
/>

<!-- Hidden file inputs for "Import .md here" / "Import folder here" - triggered from the menu -->
<input
  bind:this={importFileInputEl}
  type="file"
  accept=".md,text/markdown"
  multiple
  class="hidden"
  onchange={handleImportFilesSelected}
/>
<input
  bind:this={importFolderInputEl}
  type="file"
  webkitdirectory
  multiple
  class="hidden"
  onchange={handleImportFilesSelected}
/>

<ImportMarkdownToFolderDialog
  bind:open={importDialogOpen}
  files={importPendingFiles}
  folderId={importTargetFolder?.id ?? null}
  folderName={importTargetFolder?.name ?? ''}
  mode={importMode}
/>
