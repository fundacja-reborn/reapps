<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArrowLeft,
    ChevronRight,
    Folder as FolderIcon,
    Search,
    Check,
    Sparkles,
    X,
    ChevronDown
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

  let {
    value,
    defaultFolderName,
    label,
    onselect,
    id
  }: {
    value: string | null;
    defaultFolderName: string;
    label: string;
    onselect: (folderId: string | null) => void;
    id?: string;
  } = $props();

  const isMobileQuery = useIsMobile();

  let open = $state(false);
  let currentParentId = $state<string | null>(null);
  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let wrapperEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);

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

  const defaultFolderInTree = $derived(
    tree.find((f) => f.name === defaultFolderName) ?? null
  );
  const showVirtualDefault = $derived(
    isRoot && !searchActive && defaultFolderInTree === null
  );

  const selectedFolderName = $derived.by(() => {
    if (value === null) return null;
    const flat = flattenFolderTree(tree);
    return flat.find((f) => f.id === value)?.name ?? null;
  });

  function resetState() {
    searchQuery = '';
    if (value) {
      const ancestors = getAncestorIds(value, tree);
      currentParentId = ancestors[0] ?? null;
    } else {
      currentParentId = null;
    }
  }

  function openPicker() {
    resetState();
    open = true;
    if (!isMobileQuery.value) {
      tick().then(() => searchInputEl?.focus());
    }
  }

  function closePicker() {
    open = false;
  }

  function togglePicker() {
    if (open) closePicker();
    else openPicker();
  }

  function hasSubfolders(folderId: string): boolean {
    return findChildrenOfParent(tree, folderId).length > 0;
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

  function selectFolder(folderId: string | null, e?: Event) {
    e?.stopPropagation();
    if (folderId === value) {
      closePicker();
      return;
    }
    onselect(folderId);
    closePicker();
  }

  function handleWindowClick(e: MouseEvent) {
    if (!open || isMobileQuery.value) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (wrapperEl && wrapperEl.contains(target)) return;
    closePicker();
  }

  function handleContainerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePicker();
      triggerEl?.focus();
    }
  }

  onMount(() => {
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  });
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

    <!-- "Select this folder" row when drilled into a non-root folder -->
    {#if !isRoot}
      {@const parentId = currentParentId}
      {@const isParentSelected = parentId === value}
      <div class="mt-2 px-2">
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-md bg-primary/10 px-2 py-2 text-left text-xs font-medium text-primary hover:bg-primary/15
            {isParentSelected ? 'opacity-50' : ''}"
          onclick={(e) => selectFolder(parentId, e)}
          disabled={isParentSelected}
          aria-current={isParentSelected ? 'true' : undefined}
        >
          <Check class="h-3.5 w-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate">
            {$t('notes.periodic.settings.folder_select_this')}
          </span>
        </button>
      </div>
    {/if}

    <!-- Folder list (current level) -->
    <div class="mt-1 px-2 pb-2" role="menu">
      {#if showVirtualDefault}
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent
            {value === null ? 'bg-accent/60' : ''}"
          onclick={(e) => selectFolder(null, e)}
          aria-current={value === null ? 'true' : undefined}
        >
          <Sparkles class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-foreground">
              {$t('notes.periodic.settings.folder_default_label', {
                values: { name: defaultFolderName }
              })}
            </span>
            <span class="block truncate text-[10px] italic text-muted-foreground">
              {$t('notes.periodic.settings.folder_will_create')}
            </span>
          </span>
          {#if value === null}
            <Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {/if}
        </button>
      {/if}
      {#if currentLevel.length === 0 && !showVirtualDefault}
        <p class="px-2 py-3 text-center text-[11px] text-muted-foreground">
          {$t('notes.folder_no_subfolders')}
        </p>
      {:else}
        {#each currentLevel as folder (folder.id)}
          {@const subcount = folder.children?.length ?? 0}
          {@const isCurrent = folder.id === value}
          <div class="group flex items-stretch">
            <button
              type="button"
              role="menuitem"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 py-2 text-left text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent
                {isCurrent ? 'text-muted-foreground' : 'text-foreground'}"
              onclick={(e) => selectFolder(folder.id, e)}
              disabled={isCurrent}
              aria-current={isCurrent ? 'true' : undefined}
              title={folder.name}
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
          {@const isCurrent = r.id === value}
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent
              {isCurrent ? 'opacity-50' : ''}"
            onclick={(e) => selectFolder(r.id, e)}
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

<div bind:this={wrapperEl} class="relative">
  <button
    bind:this={triggerEl}
    {id}
    type="button"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={label}
    onclick={(e) => {
      e.stopPropagation();
      togglePicker();
    }}
    class="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
  >
    <span class="flex min-w-0 flex-1 items-center gap-2">
      {#if selectedFolderName}
        <FolderIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate">{selectedFolderName}</span>
      {:else}
        <Sparkles class="h-4 w-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate">
          {defaultFolderName}
          <span class="text-muted-foreground">
            ({$t('notes.periodic.settings.folder_will_create')})
          </span>
        </span>
      {/if}
    </span>
    <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
  </button>

  <!-- Desktop: absolute popup -->
  {#if open && !isMobileQuery.value}
    <div
      class="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-md border bg-popover shadow-md"
      role="dialog"
      tabindex="-1"
      aria-label={label}
      onkeydown={handleContainerKeydown}
      onclick={(e) => e.stopPropagation()}
    >
      <p
        class="border-b px-3 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </p>
      <div class="max-h-[min(60vh,26rem)] overflow-y-auto">
        {@render body()}
      </div>
    </div>
  {/if}
</div>

<!-- Mobile: bottom sheet -->
{#if isMobileQuery.value}
  <Sheet bind:open>
    <SheetContent side="bottom" class="flex h-auto max-h-[75dvh] flex-col p-0">
      <SheetHeader class="border-b px-4 py-3">
        <SheetTitle class="text-left text-sm">{label}</SheetTitle>
      </SheetHeader>
      <div class="flex-1 overflow-y-auto pb-4">
        {@render body()}
      </div>
    </SheetContent>
  </Sheet>
{/if}
