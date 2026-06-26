<script lang="ts">
  import { Search, ChevronUp, ChevronDown, X, CaseSensitive } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';

  let {
    query,
    caseSensitive,
    total,
    current,
    capped = false,
    isMobile = false,
    focusSignal = 0,
    oninput,
    ontogglecase,
    onnext,
    onprev,
    onclose
  }: {
    /** Current search query (controlled by the parent). */
    query: string;
    /** Whether matching is case-sensitive. */
    caseSensitive: boolean;
    /** Total number of matches in the active surface. */
    total: number;
    /** 1-based index of the active match, or 0 when there are none. */
    current: number;
    /** Whether `total` hit the match cap (renders as `N+`). */
    capped?: boolean;
    isMobile?: boolean;
    /** Bumped by the parent to (re)focus + select the input (e.g. Ctrl/Cmd+F again). */
    focusSignal?: number;
    oninput: (value: string) => void;
    ontogglecase: () => void;
    onnext: () => void;
    onprev: () => void;
    onclose: () => void;
  } = $props();

  let inputEl = $state<HTMLInputElement | null>(null);

  const hasQuery = $derived(query.length > 0);
  const noResults = $derived(hasQuery && total === 0);
  const countText = $derived(`${current}/${total}${capped ? '+' : ''}`);
  // Localized, screen-reader-friendly status (the visible counter is compact).
  const statusText = $derived(
    noResults
      ? $t('note_search.no_results')
      : hasQuery
        ? $t('note_search.position', { values: { current, total: `${total}${capped ? '+' : ''}` } })
        : ''
  );

  // Focus + select on mount and whenever the parent bumps focusSignal.
  $effect(() => {
    void focusSignal;
    const el = inputEl;
    if (!el) return;
    el.focus();
    el.select();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onprev();
      else onnext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onnext();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onprev();
    }
  }
</script>

<div
  role="search"
  class="flex items-center gap-1 border bg-popover text-popover-foreground shadow-md
    {isMobile
    ? 'w-full gap-1.5 border-x-0 border-t-0 px-2 py-1.5'
    : 'rounded-lg px-1.5 py-1'}"
>
  <Search class="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />

  <input
    bind:this={inputEl}
    type="text"
    value={query}
    oninput={(e) => oninput(e.currentTarget.value)}
    onkeydown={handleKeydown}
    placeholder={$t('note_search.placeholder')}
    aria-label={$t('note_search.placeholder')}
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
    class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground
      {isMobile ? '' : 'w-44'}"
  />

  <!-- Match counter (visible compact + localized status for assistive tech) -->
  <span class="shrink-0 px-1 text-xs tabular-nums {noResults ? 'text-destructive' : 'text-muted-foreground'}">
    {#if hasQuery}
      <span aria-hidden="true">{noResults ? $t('note_search.no_results') : countText}</span>
    {/if}
    <span class="sr-only" role="status" aria-live="polite">{statusText}</span>
  </span>

  <!-- Case-sensitive toggle -->
  <button
    type="button"
    onclick={ontogglecase}
    aria-pressed={caseSensitive}
    title={$t('note_search.match_case')}
    aria-label={$t('note_search.match_case')}
    class="flex shrink-0 items-center justify-center rounded transition-colors
      {isMobile ? 'h-8 w-8' : 'h-7 w-7'}
      {caseSensitive
      ? 'bg-accent text-accent-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
  >
    <CaseSensitive class="h-4 w-4" />
  </button>

  <div class="mx-0.5 h-5 w-px shrink-0 bg-border" role="separator"></div>

  <!-- Previous / next match -->
  <button
    type="button"
    onclick={onprev}
    disabled={total === 0}
    title={$t('note_search.previous')}
    aria-label={$t('note_search.previous')}
    class="flex shrink-0 items-center justify-center rounded text-muted-foreground transition-colors
      hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40
      {isMobile ? 'h-8 w-8' : 'h-7 w-7'}"
  >
    <ChevronUp class="h-4 w-4" />
  </button>
  <button
    type="button"
    onclick={onnext}
    disabled={total === 0}
    title={$t('note_search.next')}
    aria-label={$t('note_search.next')}
    class="flex shrink-0 items-center justify-center rounded text-muted-foreground transition-colors
      hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40
      {isMobile ? 'h-8 w-8' : 'h-7 w-7'}"
  >
    <ChevronDown class="h-4 w-4" />
  </button>

  <div class="mx-0.5 h-5 w-px shrink-0 bg-border" role="separator"></div>

  <!-- Close -->
  <button
    type="button"
    onclick={onclose}
    title={$t('note_search.close')}
    aria-label={$t('note_search.close')}
    class="flex shrink-0 items-center justify-center rounded text-muted-foreground transition-colors
      hover:bg-accent hover:text-accent-foreground
      {isMobile ? 'h-8 w-8' : 'h-7 w-7'}"
  >
    <X class="h-4 w-4" />
  </button>
</div>
