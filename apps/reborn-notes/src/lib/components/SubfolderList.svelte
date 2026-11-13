<script lang="ts">
  import { Folder, ChevronRight, MoreHorizontal } from '@lucide/svelte';
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
    DropdownMenuTrigger
  } from '@reborn/ui';
  import type { FolderWithChildren } from '@reborn/types';
  import { t } from '$lib/stores/i18n.store';
  import FolderGlyph from '$lib/components/folders/FolderGlyph.svelte';
  import FolderActionDialogs from '$lib/components/folders/FolderActionDialogs.svelte';
  import RowActionSheet from '$lib/components/shared/RowActionSheet.svelte';
  import { foldersStore } from '$lib/stores/folders.store';
  import { folderSortMode } from '$lib/stores/app-settings.store';
  import { syncedFolderConfigs } from '$lib/services/folder-sync.service';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import { buildFolderActions } from '$lib/utils/folder-actions';
  import type { RowAction } from '$lib/utils/row-action';
  import {
    pendingNewFolderDraft,
    registerNewFolderDraftInput
  } from '$lib/stores/new-folder-draft.store';

  let {
    subfolders,
    parentId = null,
    onselect,
    onnewnote = undefined,
    onnewsubfolder = undefined
  }: {
    subfolders: FolderWithChildren[];
    /** ID of the folder this list belongs to; used to match against an active new-folder draft. */
    parentId?: string | null;
    onselect: (id: string) => void;
    /** Row menu: create a note inside that subfolder (parent owns create + navigate). */
    onnewnote?: (folderId: string) => void;
    /** Row menu: open that subfolder and start a new-folder draft in it. */
    onnewsubfolder?: (folderId: string) => void;
  } = $props();

  // ── Inline new-folder draft ─────────────────────────────────────
  // Renders an editable input row at the very top when a draft was requested
  // for this folder (via the "+ subfolder" header button). Folder is created
  // on commit (Enter / blur with non-empty value); Escape drops the draft.
  // `openNewFolderDraft` focuses the input (registered by the attachment)
  // within the opening tap.
  let draftName = $state('');
  const showDraft = $derived(
    parentId !== null && $pendingNewFolderDraft?.parentId === parentId
  );

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
    if (trimmed && parentId) {
      await foldersStore.create(trimmed, parentId);
    }
  }

  function cancelDraft() {
    pendingNewFolderDraft.set(null);
  }

  // ── Inline rename ───────────────────────────────────────────────
  let editingId = $state<string | null>(null);
  let editingName = $state('');
  let editInputEl = $state<HTMLInputElement | undefined>(undefined);

  function startRename(folder: FolderWithChildren) {
    editingId = folder.id;
    editingName = folder.name;
    // Focus after DOM update
    setTimeout(() => editInputEl?.select(), 0);
  }

  // Enter commits and then removes the input, whose blur would commit a
  // second time - one commit per edit.
  let renameBusy = false;

  async function commitRename(id: string) {
    if (renameBusy || editingId !== id) return;
    renameBusy = true;
    try {
      const trimmed = editingName.trim();
      if (trimmed && trimmed !== subfolders.find((f) => f.id === id)?.name) {
        await foldersStore.rename(id, trimmed);
      }
    } finally {
      renameBusy = false;
      editingId = null;
    }
  }

  function cancelRename() {
    editingId = null;
  }

  // ── Folder menu (kebab / right-click / phone sheet, #560) ───────
  // The same menu a folder has in the tree: the list comes from
  // `buildFolderActions`, the dialogs behind it from one FolderActionDialogs.
  const isMobileQuery = useIsMobile();
  let dialogs = $state<FolderActionDialogs | undefined>(undefined);
  // Desktop: the row whose kebab or right-click menu is open - it keeps its
  // background while the pointer is on the menu.
  let menuOpenId = $state<string | null>(null);
  // Phone: the action sheet and the row it was opened for. The id outlives
  // the sheet, so its content stays put through the closing animation.
  let sheetOpen = $state(false);
  let sheetFolderId = $state<string | null>(null);
  const sheetFolder = $derived(
    sheetFolderId ? (subfolders.find((f) => f.id === sheetFolderId) ?? null) : null
  );

  function setMenuOpen(id: string, isOpen: boolean) {
    menuOpenId = isOpen ? id : menuOpenId === id ? null : menuOpenId;
  }

  function openActionSheet(id: string, e: Event) {
    e.stopPropagation();
    sheetFolderId = id;
    sheetOpen = true;
  }

  function folderDisplayName(folder: FolderWithChildren): string {
    return folder.decrypt_failed ? $t('folders.undecryptable') : folder.name;
  }

  // Custom sort only: swap the folder with its neighbour in this list.
  async function handleNudge(folder: FolderWithChildren, dir: -1 | 1) {
    const ids = subfolders.map((f) => f.id);
    const i = ids.indexOf(folder.id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await foldersStore.reorder(parentId, ids);
  }

  function folderActions(folder: FolderWithChildren, syncConfigId: string | null): RowAction[] {
    // Every item closes the menus first, then acts.
    const act = (fn: () => void) => (e?: Event) => {
      e?.stopPropagation();
      menuOpenId = null;
      sheetOpen = false;
      fn();
    };
    const idx =
      $folderSortMode === 'custom' && parentId !== null
        ? subfolders.findIndex((f) => f.id === folder.id)
        : -1;
    return buildFolderActions(
      folder,
      {
        syncNow: act(() => {
          if (syncConfigId) void dialogs?.syncNow(syncConfigId);
        }),
        newNote: onnewnote ? act(() => onnewnote?.(folder.id)) : undefined,
        // The parent opens the subfolder and starts the draft there. Deferred
        // by a task: a dropdown / right-click menu is still open while its
        // item's click runs, and its focus trap would pull the focus back
        // from the draft input (whose blur commits the default name).
        newSubfolder: onnewsubfolder
          ? act(() => setTimeout(() => onnewsubfolder?.(folder.id), 0))
          : undefined,
        rename: act(() => startRename(folder)),
        appearance: act(() => dialogs?.openAppearance(folder)),
        move: act(() => dialogs?.requestMove(folder)),
        moveUp: idx > 0 ? act(() => void handleNudge(folder, -1)) : undefined,
        moveDown:
          idx !== -1 && idx < subfolders.length - 1
            ? act(() => void handleNudge(folder, 1))
            : undefined,
        importFiles: act(() => dialogs?.importFiles(folder)),
        importFolder: act(() => dialogs?.importFolder(folder)),
        archive: act(() => void dialogs?.archive(folder)),
        remove: act(() => dialogs?.requestDelete(folder))
      },
      { t: $t, syncConfigId }
    );
  }
</script>

{#if subfolders.length > 0 || showDraft}
  <div class="mb-3 flex flex-col gap-1">
    <h2
      class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      {$t('folders.subfolders')}
    </h2>
    <ul class="flex flex-col gap-1" role="list">
      {#if showDraft}
        <li>
          <div
            class="flex items-center gap-2 rounded-lg p-3 text-sm bg-accent/30"
          >
            <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              {@attach registerNewFolderDraftInput}
              bind:value={draftName}
              class="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm caret-primary focus:outline-none focus:ring-1 focus:ring-primary"
              onkeydown={(e) => {
                if (e.key === 'Enter') commitDraft();
                if (e.key === 'Escape') cancelDraft();
              }}
              onblur={commitDraft}
              aria-label={$t('folders.new_subfolder')}
            />
          </div>
        </li>
      {/if}
      {#each subfolders as folder (folder.id)}
        {@const editing = editingId === folder.id}
        {@const syncConfigId = $syncedFolderConfigs.get(folder.id) ?? null}
        {@const rowActions = folderActions(folder, syncConfigId)}
        {@const menuActive =
          menuOpenId === folder.id || (sheetOpen && sheetFolderId === folder.id)}
        <li>
          <!-- Right-click opens the same folder menu as in the tree (#560).
               Disabled on a phone (the kebab opens a sheet there) and while
               renaming in place. -->
          <ContextMenu onOpenChange={(o) => setMenuOpen(folder.id, o)}>
            <ContextMenuTrigger disabled={isMobileQuery.value || editing}>
              {#snippet child({ props: triggerProps })}
                <div
                  {...triggerProps}
                  role="button"
                  tabindex="0"
                  class="group flex cursor-pointer items-center gap-2 rounded-lg p-3 text-sm transition-colors {menuActive
                    ? 'bg-accent/50'
                    : 'hover:bg-accent/50'}"
                  onclick={() => !editing && onselect(folder.id)}
                  onkeydown={(e) => {
                    // Only the row's own Enter: the rename input and the kebab
                    // inside it handle theirs.
                    if (e.key === 'Enter' && e.target === e.currentTarget) onselect(folder.id);
                  }}
                >
                  <FolderGlyph color={folder.color} icon={folder.icon} />
                  {#if editing}
                    <!-- Negative margin: the taller input must not grow the row. -->
                    <input
                      bind:this={editInputEl}
                      bind:value={editingName}
                      class="-my-1.5 min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm caret-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      onclick={(e) => e.stopPropagation()}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') commitRename(folder.id);
                        if (e.key === 'Escape') cancelRename();
                      }}
                      onblur={() => commitRename(folder.id)}
                      aria-label={$t('folders.rename')}
                    />
                  {:else if folder.decrypt_failed}
                    <!-- Name is the only ciphertext - the folder itself stays browsable. -->
                    <span
                      class="min-w-0 flex-1 truncate italic text-muted-foreground"
                      title={$t('folders.undecryptable_hint')}>{$t('folders.undecryptable')}</span
                    >
                  {:else}
                    <span class="min-w-0 flex-1 truncate"><bdi>{folder.name}</bdi></span>
                  {/if}
                  {#if !editing}
                    <!-- Kebab: always shown where there is no hover (phone: opens
                         the sheet; tablet: the dropdown), on row hover
                         elsewhere. Negative margins keep the row height while
                         the tap target stays large. -->
                    {#if isMobileQuery.value}
                      <button
                        type="button"
                        onclick={(e) => openActionSheet(folder.id, e)}
                        class="-my-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={$t('folders.folder_actions')}
                        tabindex="-1"
                      >
                        <MoreHorizontal class="h-4 w-4" />
                      </button>
                    {:else}
                      <DropdownMenu onOpenChange={(o) => setMenuOpen(folder.id, o)}>
                        <DropdownMenuTrigger>
                          {#snippet child({ props })}
                            <button
                              {...props}
                              type="button"
                              onclick={(e) => e.stopPropagation()}
                              class="-my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 pointer-coarse:opacity-100 {menuActive
                                ? 'opacity-100'
                                : 'opacity-0'}"
                              aria-label={$t('folders.folder_actions')}
                              tabindex="-1"
                            >
                              <MoreHorizontal class="h-4 w-4" />
                            </button>
                          {/snippet}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" class="min-w-44">
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
                    <ChevronRight
                      class="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 group-hover:text-muted-foreground"
                    />
                  {/if}
                </div>
              {/snippet}
            </ContextMenuTrigger>
            {#if !isMobileQuery.value && !editing}
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
        </li>
      {/each}
    </ul>
  </div>
{/if}

<!-- Phone: folder action sheet - the same list as the desktop menus. -->
{#if isMobileQuery.value}
  <RowActionSheet
    bind:open={sheetOpen}
    title={sheetFolder ? folderDisplayName(sheetFolder) : ''}
    hint={sheetFolder?.decrypt_failed ? $t('folders.undecryptable_hint') : undefined}
    actions={sheetFolder
      ? folderActions(sheetFolder, $syncedFolderConfigs.get(sheetFolder.id) ?? null)
      : []}
  />
{/if}

<!-- Outside the `#if` above: a dialog must outlive the list when its action
     empties it (moving or deleting the last subfolder). -->
<FolderActionDialogs bind:this={dialogs} />
