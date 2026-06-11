<script lang="ts">
  import { Search, X, Bookmark } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';

  let {
    searchInput = $bindable(''),
    searchInContent = $bindable(false),
    searchInputEl = $bindable<HTMLInputElement | null>(null),
    searchOnly = false,
    onsavesearch
  }: {
    searchInput: string;
    searchInContent: boolean;
    searchInputEl?: HTMLInputElement | null;
    searchOnly?: boolean;
    /** Optional "save this search" affordance (shown when a query is typed). */
    onsavesearch?: () => void;
  } = $props();

  function handleSearchInput(e: Event) {
    searchInput = (e.target as HTMLInputElement).value;
  }

  function clearSearch() {
    searchInput = '';
    searchInContent = false;
  }

  function toggleSearchInContent() {
    searchInContent = !searchInContent;
  }
</script>

<div class="shrink-0 px-3 pb-2 {searchOnly ? 'pt-3' : ''}">
  <div class="relative">
    <Search class="absolute left-2.5 top-1/2 h-4 w-4 md:h-3.5 md:w-3.5 -translate-y-1/2 text-muted-foreground" />
    <input
      bind:this={searchInputEl}
      type="text"
      placeholder={$t('notes.search_placeholder')}
      value={searchInput}
      oninput={handleSearchInput}
      class="w-full rounded-md border bg-background py-2.5 md:py-2 pl-8 md:pl-7 pr-10 md:pr-8 text-sm md:text-xs focus:outline-none focus:ring-1 focus:ring-primary"
      aria-label={$t('notes.search_placeholder')}
    />
    {#if searchInput}
      <button
        type="button"
        onclick={clearSearch}
        class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center h-9 w-9 md:h-7 md:w-7 text-muted-foreground hover:text-foreground"
        aria-label={$t('notes.clear_search')}
      >
        <X class="h-4 w-4 md:h-3.5 md:w-3.5" />
      </button>
    {/if}
  </div>
  {#if searchInput}
    <!-- Mobile: 44px-tall tap targets (HIG minimum) with breathing room from the
         input; desktop keeps the previous compact text-row look via md:. -->
    <div class="mt-0.5 md:mt-1 flex items-center justify-between gap-2">
      <button
        type="button"
        onclick={toggleSearchInContent}
        class="flex min-h-[44px] md:min-h-0 items-center gap-2 md:gap-1 px-1 -mx-1 md:px-0 md:mx-0 text-sm md:text-[11px] transition-colors
          {searchInContent
          ? 'font-medium text-primary'
          : 'text-muted-foreground hover:text-foreground'}"
      >
        <span
          class="inline-flex h-5 w-5 md:h-3 md:w-3 items-center justify-center rounded border
          {searchInContent
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground'}"
        >
          {#if searchInContent}✓{/if}
        </span>
        {$t('notes.search_in_content')}
      </button>
      {#if onsavesearch}
        <button
          type="button"
          onclick={onsavesearch}
          class="flex min-h-[44px] md:min-h-0 shrink-0 items-center gap-2 md:gap-1 px-1 -mx-1 md:px-0 md:mx-0 text-sm md:text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Bookmark class="h-5 w-5 md:h-3 md:w-3" />
          {$t('saved_searches.save_button')}
        </button>
      {/if}
    </div>
  {/if}
</div>
