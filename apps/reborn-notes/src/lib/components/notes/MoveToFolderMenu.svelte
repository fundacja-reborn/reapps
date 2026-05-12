<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArrowLeft,
    ChevronRight,
    Folder as FolderIcon,
    Search,
    Check,
    FileText,
    X
  } from '@lucide/svelte';
  import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { foldersStore } from '$lib/stores/folders.store';
  import {
    findChildrenOfParent,
    buildBreadcrumb,
    buildPathString,
    flattenFolderTree,
    getAncestorIds
  } from '$lib/utils/folder-helpers';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';

  /**
   * Move target — single note keeps the "already here" disabled state and auto-navigates
   * to the parent of the current folder on open; multi-note skips both (selected notes
   * may span folders, and there's no single "current folder" to compare against).
   */
  export type MoveSelection =
    | { kind: 'single'; id: string; currentFolderId: string | null }
    | { kind: 'multi'; count: number };

  let {
    selection,
    open = $bindable(false),
    forceSheet = false,
    onmove,
    onclose
  }: {
    selection: MoveSelection | null;
    open?: boolean;
    /** Force the bottom-sheet variant on desktop too — used by bulk move which has no
     *  anchoring button for the absolute desktop popup. */
    forceSheet?: boolean;
    onmove: (folderId: string | null, e?: Event) => void;
    onclose?: () => void;
  } = $props();

  const isMobileQuery = useIsMobile();
  const useSheet = $derived(forceSheet || isMobileQuery.value);

  let currentParentId = $state<string | null>(null);
  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let containerEl = $state<HTMLDivElement | null>(null);

  const tree = $derived($foldersStore);
  const currentLevel = $derived(findChildrenOfParent(tree, currentParentId));
  const breadcrumb = $derived(buildBreadcrumb(tree, currentParentId));
  const isRoot = $derived(currentParentId === null);
  const searchActive = $derived(searchQuery.trim().length > 0);
  const searchTerm = $derived(searchQuery.trim().toLowerCase());
  const searchResults = $derived(
    searchActive
      ? flattenFolderTree(tree)
          .filter((f) => f.name.toLowerCase().includes(searchTerm))
          .map((f) => ({ id: f.id, name: f.name, path: buildPathString(tree, f.id) }))
          .slice(0, 50)
      : []
  );

  // In multi-note mode `currentFolderId` is intentionally null: selected notes may live in
  // different folders, so no single folder can be highlighted as "current".
  const currentFolderId = $derived(
    selection?.kind === 'single' ? selection.currentFolderId : null
  );

  // Auto-navigate to the parent of the note's current folder when opened (single mode only).
  function resetForOpen() {
    searchQuery = '';
    if (selection?.kind === 'single' && selection.currentFolderId) {
      const ancestors = getAncestorIds(selection.currentFolderId, tree);
      currentParentId = ancestors[0] ?? null;
    } else {
      currentParentId = null;
    }
  }

  // Desktop: the component is conditionally mounted by the parent when showing.
  // Mobile: the component stays mounted; we react to `open` becoming true.
  let lastOpen = $state(false);
  $effect(() => {
    if (open && !lastOpen) resetForOpen();
    lastOpen = open;
  });

  onMount(() => {
    if (!useSheet) {
      resetForOpen();
      // Autofocus search on desktop after paint
      tick().then(() => searchInputEl?.focus());
    }
  });

  function hasSubfolders(folderId: string): boolean {
    const children = findChildrenOfParent(tree, folderId);
    return children.length > 0;
  }

  function drillInto(folderId: string, e?: Event) {
    e?.stopPropagation();
    currentParentId = folderId;
    searchQuery = '';
    tick().then(() => searchInputEl?.focus());
  }

  function goBack(e?: Event) {
    e?.stopPropagation();
    if (isRoot) return;
    const crumbs = breadcrumb;
    currentParentId = crumbs.length >= 2 ? crumbs[crumbs.length - 2]!.id : null;
  }

  function doMove(folderId: string | null, e?: Event) {
    if (!selection) return;
    if (selection.kind === 'single' && folderId === (selection.currentFolderId ?? null)) {
      // no-op: already in this folder
      closeMenu();
      return;
    }
    onmove(folderId, e);
    closeMenu();
  }

  function closeMenu() {
    open = false;
    onclose?.();
  }

  function handleRowClick(folderId: string, e?: Event) {
    e?.stopPropagation();
    if (folderId === currentFolderId) return;
    if (hasSubfolders(folderId)) {
      drillInto(folderId, e);
    } else {
      doMove(folderId, e);
    }
  }

  function handleContainerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  }
</script>

{#snippet body()}
  <!-- Search -->
  <div class="px-2 pt-2">
    <div class="relative">
      <Search
        class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        bind:this={searchInputEl}
        type="text"
        bind:value={searchQuery}
        placeholder={$t('notes.folder_search_placeholder')}
        aria-label={$t('notes.folder_search_placeholder')}
        class="h-8 w-full rounded-md border bg-background pl-8 pr-7 text-xs outline-none focus:ring-1 focus:ring-primary"
        onkeydown={(e) => {
          if (e.key === 'Escape' && searchQuery) {
            e.stopPropagation();
            searchQuery = '';
          }
        }}
      />
      {#if searchQuery}
        <button
          type="button"
          onclick={() => {
            searchQuery = '';
            searchInputEl?.focus();
          }}
          class="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={$t('notes.clear_search')}
          tabindex="-1"
        >
          <X class="h-3 w-3" />
        </button>
      {/if}
    </div>
  </div>

  {#if !searchActive}
    <!-- Breadcrumb / back (non-root) -->
    {#if !isRoot}
      <div class="mt-1.5 flex items-center gap-1 px-2">
        <button
          type="button"
          onclick={goBack}
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={$t('notes.folder_back')}
        >
          <ArrowLeft class="h-3.5 w-3.5" />
        </button>
        <nav
          aria-label={$t('notes.folder_current_location')}
          class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
        >
          {#each breadcrumb as crumb, i (crumb.id)}
            {#if i > 0}<span class="mx-1 opacity-60">›</span>{/if}
            {#if i < breadcrumb.length - 1}
              <button
                type="button"
                class="rounded px-0.5 hover:text-foreground hover:underline"
                onclick={(e) => drillInto(crumb.id, e)}
              >
                {crumb.name}
              </button>
            {:else}
              <span class="font-medium text-foreground">{crumb.name}</span>
            {/if}
          {/each}
        </nav>
      </div>
    {/if}

    <!-- Primary action row: "No folder" at root, "Move here" otherwise -->
    <div class="mt-2 px-2">
      {#if isRoot}
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent
            {currentFolderId === null ? 'text-muted-foreground' : 'text-foreground'}"
          onclick={(e) => doMove(null, e)}
          disabled={currentFolderId === null}
          aria-current={currentFolderId === null ? 'true' : undefined}
        >
          <FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{$t('notes.no_folder')}</span>
          {#if currentFolderId === null}
            <Check class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {/if}
        </button>
      {:else}
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-md bg-primary/10 px-2 py-2 text-left text-xs font-medium text-primary hover:bg-primary/15
            {currentFolderId === currentParentId ? 'opacity-50' : ''}"
          onclick={(e) => doMove(currentParentId, e)}
          disabled={currentFolderId === currentParentId}
          aria-current={currentFolderId === currentParentId ? 'true' : undefined}
        >
          <Check class="h-3.5 w-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{$t('notes.move_here')}</span>
        </button>
      {/if}
    </div>

    <!-- Folder list (current level) -->
    <div class="mt-1 px-2 pb-2" role="menu">
      {#if currentLevel.length === 0}
        <p class="px-2 py-3 text-center text-[11px] text-muted-foreground">
          {$t('notes.folder_no_subfolders')}
        </p>
      {:else}
        {#each currentLevel as folder (folder.id)}
          {@const subcount = folder.children?.length ?? 0}
          {@const isCurrent = folder.id === currentFolderId}
          <div class="group flex items-stretch">
            <button
              type="button"
              role="menuitem"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 py-2 text-left text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent
                {isCurrent ? 'text-muted-foreground' : 'text-foreground'}"
              onclick={(e) => handleRowClick(folder.id, e)}
              disabled={isCurrent}
              aria-current={isCurrent ? 'true' : undefined}
              title={isCurrent ? $t('notes.folder_current_location') : folder.name}
            >
              <FolderIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{folder.name}</span>
              {#if isCurrent}
                <Check class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {/if}
            </button>
            {#if subcount > 0}
              <button
                type="button"
                class="flex shrink-0 items-center justify-center gap-0.5 rounded-r-md px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                onclick={(e) => drillInto(folder.id, e)}
                aria-label={$t('folders.expand')}
                title={$t('folders.expand')}
                tabindex="-1"
              >
                <span class="text-[10px]">{subcount}</span>
                <ChevronRight class="h-3.5 w-3.5" />
              </button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {:else}
    <!-- Search results (flat, with path) -->
    <div class="mt-2 px-2 pb-2" role="menu">
      {#if searchResults.length === 0}
        <p class="px-2 py-4 text-center text-[11px] text-muted-foreground">
          {$t('notes.folder_no_results')}
        </p>
      {:else}
        {#each searchResults as r (r.id)}
          {@const isCurrent = r.id === currentFolderId}
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent
              {isCurrent ? 'opacity-50' : ''}"
            onclick={(e) => doMove(r.id, e)}
            disabled={isCurrent}
            aria-current={isCurrent ? 'true' : undefined}
          >
            <FolderIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs text-foreground">{r.name}</span>
              {#if r.path}
                <span class="block truncate text-[10px] text-muted-foreground">{r.path}</span>
              {/if}
            </span>
            {#if isCurrent}
              <Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
{/snippet}

<!-- Desktop popup: absolute, anchored inside the parent's relative container.
     Skipped when forceSheet (bulk move has no per-item anchor). -->
{#if !useSheet}
  <div
    bind:this={containerEl}
    class="absolute right-0 top-7 z-50 w-[300px] overflow-hidden rounded-md border bg-popover shadow-md"
    role="dialog"
    tabindex="-1"
    aria-label={$t('notes.move_to')}
    onkeydown={handleContainerKeydown}
    onclick={(e) => e.stopPropagation()}
  >
    <p
      class="border-b px-3 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      {$t('notes.move_to')}
    </p>
    <div class="max-h-[min(60vh,26rem)] overflow-y-auto">
      {@render body()}
    </div>
  </div>
{/if}

<!-- Sheet: mobile by default, also desktop when forceSheet is set. -->
{#if useSheet}
  <Sheet bind:open>
    <SheetContent side="bottom" class="flex h-auto max-h-[75dvh] flex-col p-0">
      <SheetHeader class="border-b px-4 py-3">
        <SheetTitle class="text-left text-sm">{$t('notes.move_to')}</SheetTitle>
      </SheetHeader>
      <div class="flex-1 overflow-y-auto pb-4">
        {@render body()}
      </div>
    </SheetContent>
  </Sheet>
{/if}
