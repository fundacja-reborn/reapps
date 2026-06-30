<script lang="ts">
  import type { SavedSearchDecrypted } from '@reborn/types';
  import { savedSearchesStore } from '$lib/stores/saved-searches.store';
  import { t } from '$lib/stores/i18n.store';
  import SavedSearchRow from './SavedSearchRow.svelte';
  import MoveToFolderMenu from './MoveToFolderMenu.svelte';

  let {
    onselect
  }: {
    onselect: (search: SavedSearchDecrypted) => void;
  } = $props();

  // ── Park in folder (shared picker, sheet variant on all breakpoints -
  //    panel rows have no anchor for the desktop popup; precedent: bulk move) ──
  let movingSearch = $state<SavedSearchDecrypted | null>(null);
  let moveOpen = $state(false);

  function requestMove(search: SavedSearchDecrypted) {
    movingSearch = search;
    moveOpen = true;
  }

  async function handleMove(folderId: string | null) {
    if (!movingSearch) return;
    await savedSearchesStore.move(movingSearch.id, folderId);
    movingSearch = null;
  }

  async function handlePinRoot() {
    if (!movingSearch) return;
    await savedSearchesStore.pinToRoot(movingSearch.id);
    movingSearch = null;
  }
</script>

<div class="py-2">
  <p class="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
    {$t('saved_searches.title')}
  </p>
  <ul class="select-none">
    {#each $savedSearchesStore as search (search.id)}
      <SavedSearchRow {search} context="panel" {onselect} onrequestmove={requestMove} />
    {/each}
  </ul>
</div>

<MoveToFolderMenu
  selection={movingSearch
    ? {
        kind: 'single',
        id: movingSearch.id,
        currentFolderId: movingSearch.folder_id ?? null,
        currentPinnedToRoot: movingSearch.pinned_to_root
      }
    : null}
  bind:open={moveOpen}
  forceSheet
  mode="pin"
  onmove={(folderId) => handleMove(folderId)}
  onpinroot={handlePinRoot}
  onclose={() => (movingSearch = null)}
/>
