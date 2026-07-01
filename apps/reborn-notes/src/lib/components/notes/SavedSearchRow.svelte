<script lang="ts">
  import {
    SearchCheck,
    SearchCode,
    MoreHorizontal,
    Pencil,
    Trash2,
    FolderInput,
    FolderX
  } from '@lucide/svelte';
  import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
  } from '@reborn/ui';
  import type { SavedSearchDecrypted } from '@reborn/types';
  import { savedSearchesStore } from '$lib/stores/saved-searches.store';
  import { t } from '$lib/stores/i18n.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import ConfirmDialog from '../shared/ConfirmDialog.svelte';
  import EditSavedSearchQueryDialog from './EditSavedSearchQueryDialog.svelte';

  let {
    search,
    context,
    depth = 0,
    active = false,
    highlight = false,
    onselect,
    onrequestmove
  }: {
    search: SavedSearchDecrypted;
    /** 'panel' = master list in the search section; 'tree' = parked node in the folder tree. */
    context: 'panel' | 'tree';
    /** Indentation level (tree context only). */
    depth?: number;
    /** Tree context: this smart folder is the one currently open in the main list. */
    active?: boolean;
    /** Momentary flash after this search was just saved, so the new row stands out. */
    highlight?: boolean;
    onselect: (search: SavedSearchDecrypted) => void;
    /** Panel only: open the folder picker for parking this search. */
    onrequestmove?: (search: SavedSearchDecrypted) => void;
  } = $props();

  const isMobileQuery = useIsMobile();

  // ── Inline rename ───────────────────────────────────────────────
  let editing = $state(false);
  let editingName = $state('');
  let editInputEl = $state<HTMLInputElement | undefined>(undefined);

  function startRename(e?: Event) {
    e?.stopPropagation();
    // Clear the menu open-state before the kebab unmounts under the rename input,
    // so it can't spuriously re-open when rename ends and the kebab remounts.
    menuOpen = false;
    actionSheetOpen = false;
    editing = true;
    editingName = search.name;
    setTimeout(() => editInputEl?.select(), 0);
  }

  async function commitRename() {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== search.name) {
      await savedSearchesStore.rename(search.id, trimmed);
    }
    editing = false;
  }

  // ── Actions ─────────────────────────────────────────────────────
  let actionSheetOpen = $state(false);
  let deleteDialogOpen = $state(false);
  let editQueryDialogOpen = $state(false);
  // Desktop kebab open state - held so the row keeps a background while its menu
  // is open (otherwise moving the pointer onto the menu drops the hover, and you
  // lose track of which row the menu belongs to).
  let menuOpen = $state(false);
  const rowMenuActive = $derived(menuOpen || actionSheetOpen);

  function handleMenuButton(e: Event) {
    e.stopPropagation();
    actionSheetOpen = true;
  }

  function startEditQuery(e?: Event) {
    e?.stopPropagation();
    actionSheetOpen = false;
    editQueryDialogOpen = true;
  }

  function requestMove(e?: Event) {
    e?.stopPropagation();
    actionSheetOpen = false;
    onrequestmove?.(search);
  }

  async function unpark(e?: Event) {
    e?.stopPropagation();
    actionSheetOpen = false;
    await savedSearchesStore.move(search.id, null);
  }

  function requestDelete(e?: Event) {
    e?.stopPropagation();
    actionSheetOpen = false;
    deleteDialogOpen = true;
  }
</script>

<li role={context === 'tree' ? 'treeitem' : 'listitem'} aria-selected={context === 'tree' ? false : undefined}>
  <div
    class="group relative flex items-center gap-1.5 rounded-md px-2 py-2.5 text-sm cursor-pointer transition-colors
      {active
      ? 'list-row-active text-accent-foreground font-medium'
      : rowMenuActive
        ? 'bg-accent/50 text-foreground'
        : 'text-foreground hover:bg-accent/50'}"
    class:saved-search-just-saved={highlight}
    style="padding-left: {depth * 0.75 + 0.5}rem"
    role="button"
    tabindex="0"
    onclick={() => !editing && onselect(search)}
    onkeydown={(e) => e.key === 'Enter' && !editing && onselect(search)}
    aria-label={$t('saved_searches.item_label', { values: { name: search.name } })}
    title={search.query}
  >
    <SearchCheck class="h-4 w-4 shrink-0 text-muted-foreground" />

    {#if editing}
      <input
        bind:this={editInputEl}
        bind:value={editingName}
        class="min-w-0 flex-1 rounded-md border bg-background px-2 py-0.5 text-sm caret-primary focus:outline-none focus:ring-1 focus:ring-primary"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitRename();
          if (e.key === 'Escape') editing = false;
        }}
        onblur={commitRename}
      />
    {:else}
      <span class="min-w-0 flex-1 truncate">{search.name}</span>
      {#if context === 'panel'}
        <span class="hidden max-w-[40%] shrink-0 truncate text-xs text-muted-foreground md:inline">
          {search.query}
        </span>
      {/if}
    {/if}

    {#if !editing}
      {#if isMobileQuery.value}
        <button
          type="button"
          onclick={handleMenuButton}
          class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={$t('saved_searches.actions')}
          tabindex="-1"
        >
          <MoreHorizontal class="h-3.5 w-3.5" />
        </button>
      {:else}
        <DropdownMenu bind:open={menuOpen}>
          <DropdownMenuTrigger>
            {#snippet child({ props })}
              <button
                {...props}
                type="button"
                onclick={(e) => e.stopPropagation()}
                class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:bg-accent hover:text-foreground"
                aria-label={$t('saved_searches.actions')}
                tabindex="-1"
              >
                <MoreHorizontal class="h-3.5 w-3.5" />
              </button>
            {/snippet}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-36">
            <DropdownMenuItem onclick={startRename}>
              <Pencil class="h-3.5 w-3.5" />
              {$t('saved_searches.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onclick={startEditQuery}>
              <SearchCode class="h-3.5 w-3.5" />
              {$t('saved_searches.edit_query')}
            </DropdownMenuItem>
            {#if context === 'panel'}
              <DropdownMenuItem onclick={requestMove}>
                <FolderInput class="h-3.5 w-3.5" />
                {$t('saved_searches.move_to_folder')}
              </DropdownMenuItem>
            {/if}
            {#if search.folder_id || search.pinned_to_root}
              <DropdownMenuItem onclick={unpark}>
                <FolderX class="h-3.5 w-3.5" />
                {$t('saved_searches.unpark')}
              </DropdownMenuItem>
            {/if}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              class="text-destructive focus:text-destructive"
              onclick={requestDelete}
            >
              <Trash2 class="h-3.5 w-3.5" />
              {$t('saved_searches.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      {/if}
    {/if}
  </div>
</li>

<!-- Mobile: action Sheet -->
{#if isMobileQuery.value}
  <Sheet bind:open={actionSheetOpen}>
    <SheetContent side="bottom" class="h-auto">
      <SheetHeader>
        <SheetTitle>{search.name}</SheetTitle>
      </SheetHeader>
      <div class="mt-4 space-y-1">
        <Button variant="ghost" class="w-full justify-start" onclick={() => startRename()}>
          <Pencil class="mr-2 h-4 w-4" />
          {$t('saved_searches.rename')}
        </Button>
        <Button variant="ghost" class="w-full justify-start" onclick={() => startEditQuery()}>
          <SearchCode class="mr-2 h-4 w-4" />
          {$t('saved_searches.edit_query')}
        </Button>
        {#if context === 'panel'}
          <Button variant="ghost" class="w-full justify-start" onclick={() => requestMove()}>
            <FolderInput class="mr-2 h-4 w-4" />
            {$t('saved_searches.move_to_folder')}
          </Button>
        {/if}
        {#if search.folder_id || search.pinned_to_root}
          <Button variant="ghost" class="w-full justify-start" onclick={() => unpark()}>
            <FolderX class="mr-2 h-4 w-4" />
            {$t('saved_searches.unpark')}
          </Button>
        {/if}
        <Button
          variant="ghost"
          class="w-full justify-start text-destructive hover:text-destructive"
          onclick={() => requestDelete()}
        >
          <Trash2 class="mr-2 h-4 w-4" />
          {$t('saved_searches.delete')}
        </Button>
      </div>
    </SheetContent>
  </Sheet>
{/if}

<EditSavedSearchQueryDialog bind:open={editQueryDialogOpen} {search} />

<ConfirmDialog
  bind:open={deleteDialogOpen}
  title={$t('saved_searches.delete_confirm_title', { values: { name: search.name } })}
  description={$t('saved_searches.delete_confirm_desc')}
  confirmText={$t('saved_searches.delete')}
  cancelText={$t('saved_searches.dialog.cancel')}
  destructive
  onConfirm={async () => {
    await savedSearchesStore.remove(search.id);
  }}
/>
