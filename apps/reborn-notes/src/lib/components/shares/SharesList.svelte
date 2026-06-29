<script lang="ts">
  import { RefreshCw, AlertTriangle, FileText, Lock, ArrowDownUp, Search, X, Clock } from '@lucide/svelte';
  import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
  } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { activeShares, activeShareId, sharesBySourceId, sharesStore } from '$lib/stores/shares.store';
  import type { OwnShareListItem } from '@reborn/types';

  // One row per active share LINK (flat list). A note shared more than once shows
  // one row per link, distinguished by expiry / opens and an "N links" pill -
  // matches the rail badge (which counts links) and avoids the snapshot-divergence
  // ambiguity of grouping by note (each link is its own point-in-time snapshot).
  type ShareSort = 'created' | 'expires' | 'opens' | 'title';

  let searchInput = $state('');
  let sortBy = $state<ShareSort>('created');

  const storeState = $derived($sharesStore);
  const decoded = $derived(storeState.decoded);
  const isLoading = $derived(storeState.loading);
  const loadError = $derived(storeState.error !== null);
  const everLoaded = $derived(storeState.lastFetchedAt !== null);

  function titleOf(s: OwnShareListItem): string {
    const p = decoded[s.id]?.payload;
    return (p?.display_name?.trim() || p?.title || '').trim();
  }

  function expiresMs(s: OwnShareListItem): number {
    return s.expires_at ? new Date(s.expires_at).getTime() : Number.POSITIVE_INFINITY;
  }

  // Expiring soon = within 24h: surfaces a badge so the user can renew a link
  // before it silently dies.
  function isExpiringSoon(s: OwnShareListItem): boolean {
    if (!s.expires_at) return false;
    const remaining = expiresMs(s) - Date.now();
    return remaining > 0 && remaining < 24 * 60 * 60 * 1000;
  }

  // activeShares already excludes revoked / expired / exhausted links.
  const rows = $derived.by(() => {
    const q = searchInput.trim().toLowerCase();
    const list = q
      ? $activeShares.filter((s) => titleOf(s).toLowerCase().includes(q))
      : [...$activeShares];
    list.sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
        case 'expires':
          return expiresMs(a) - expiresMs(b);
        case 'opens':
          return b.access_count - a.access_count;
        case 'created':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return list;
  });

  function formatDate(iso: string | null): string {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
    } catch {
      return iso;
    }
  }

  function formatOpens(s: OwnShareListItem): string {
    return s.max_access_count !== null
      ? `${s.access_count} / ${s.max_access_count}`
      : String(s.access_count);
  }

  // Number of active links pointing at the same source note (>1 => show a pill).
  function linkCountFor(s: OwnShareListItem): number {
    const src = decoded[s.id]?.payload.source_id;
    if (!src) return 1;
    return $sharesBySourceId.get(src)?.length ?? 1;
  }

  const SORT_OPTIONS: { value: ShareSort; label: string }[] = $derived([
    { value: 'created', label: $t('share.list.sort.created') },
    { value: 'expires', label: $t('share.list.sort.expires') },
    { value: 'opens', label: $t('share.list.sort.opens') },
    { value: 'title', label: $t('share.list.sort.title') }
  ]);
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Header: title + count + sort + refresh. Grows by the iOS notch inset on
       mobile (where this list owns the panel header); compact h-10 on desktop. -->
  <div
    class="flex shrink-0 items-center gap-1 px-5 pt-[env(safe-area-inset-top,0px)]
           min-h-[calc(3.5rem+env(safe-area-inset-top,0px))] md:min-h-10 md:pt-0"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium md:font-normal">{$t('share.list.title')}</p>
      <p class="text-xs text-muted-foreground">
        {$t('share.list.count', { values: { count: rows.length } })}
      </p>
    </div>

    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            title={$t('share.list.sort_label')}
            aria-label={$t('share.list.sort_label')}
            class="flex h-9 w-9 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-md
                   text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowDownUp class="h-4 w-4 md:h-3.5 md:w-3.5" />
          </button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-44">
        <p class="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {$t('share.list.sort_label')}
        </p>
        {#each SORT_OPTIONS as option (option.value)}
          <DropdownMenuItem
            class={sortBy === option.value ? 'font-medium text-foreground' : 'text-muted-foreground'}
            onclick={() => (sortBy = option.value)}
          >
            {option.label}
            {#if sortBy === option.value}<span class="ml-auto text-primary">✓</span>{/if}
          </DropdownMenuItem>
        {/each}
      </DropdownMenuContent>
    </DropdownMenu>

    <button
      type="button"
      onclick={() => sharesStore.refresh()}
      disabled={isLoading}
      title={$t('share.list.retry_action')}
      aria-label={$t('share.list.retry_action')}
      class="flex h-9 w-9 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-md
             text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground
             disabled:pointer-events-none disabled:opacity-50"
    >
      <RefreshCw class="h-4 w-4 md:h-3.5 md:w-3.5 {isLoading ? 'animate-spin' : ''}" />
    </button>
  </div>

  <!-- Search -->
  <div class="px-3 pb-2">
    <div class="relative">
      <Search
        class="absolute left-2.5 top-1/2 h-4 w-4 md:h-3.5 md:w-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="text"
        placeholder={$t('share.list.search_placeholder')}
        bind:value={searchInput}
        class="w-full rounded-md border bg-background py-2.5 md:py-2 pl-8 md:pl-7 pr-9 text-sm md:text-xs
               placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        aria-label={$t('share.list.search_placeholder')}
      />
      {#if searchInput}
        <button
          type="button"
          onclick={() => (searchInput = '')}
          class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={$t('notes.clear_search')}
        >
          <X class="h-4 w-4 md:h-3.5 md:w-3.5" />
        </button>
      {/if}
    </div>
  </div>

  <div class="mx-3 border-t"></div>

  <!-- List -->
  <div class="flex-1 overflow-y-auto px-2 py-2">
    {#if isLoading && rows.length === 0}
      <div class="flex justify-center py-8">
        <RefreshCw class="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    {:else if loadError && !everLoaded}
      <div class="flex flex-col items-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground">
        <AlertTriangle class="h-5 w-5 text-amber-500" aria-hidden="true" />
        <p>{$t('share.list.error_load')}</p>
        <Button variant="outline" size="sm" disabled={isLoading} onclick={() => sharesStore.refresh()}>
          <RefreshCw class="mr-1.5 h-3.5 w-3.5 {isLoading ? 'animate-spin' : ''}" />
          {$t('share.list.retry_action')}
        </Button>
      </div>
    {:else if rows.length === 0}
      <p class="px-2 py-6 text-center text-xs text-muted-foreground">
        {searchInput ? $t('share.list.search_no_match') : $t('share.list.empty')}
      </p>
    {:else}
      {#each rows as share (share.id)}
        {@const title = titleOf(share)}
        {@const expiringSoon = isExpiringSoon(share)}
        {@const links = linkCountFor(share)}
        <button
          type="button"
          onclick={() => activeShareId.set(share.id)}
          class="group mb-0.5 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors
            {$activeShareId === share.id
            ? 'list-row-active text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/60'}"
          aria-current={$activeShareId === share.id ? 'true' : undefined}
        >
          <FileText class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5">
              <span class="min-w-0 flex-1 truncate text-sm font-medium">
                {title || $t('share.list.untitled')}
              </span>
              {#if share.has_password}
                <Lock
                  class="h-3 w-3 shrink-0 text-muted-foreground"
                  aria-label={$t('share.list.password_protected')}
                />
              {/if}
            </span>
            <span
              class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground"
            >
              {#if expiringSoon}
                <span class="inline-flex items-center gap-0.5 font-medium text-amber-600 dark:text-amber-400">
                  <Clock class="h-3 w-3" />{$t('share.list.expiring_soon')}
                </span>
              {/if}
              <span
                >{$t('share.list.column.expires')}: {share.expires_at
                  ? formatDate(share.expires_at)
                  : $t('share.create.expires.never')}</span
              >
              <span aria-hidden="true">·</span>
              <span>{$t('share.list.column.access_count')}: {formatOpens(share)}</span>
              {#if links > 1}
                <span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {$t('share.list.links_badge', { values: { count: links } })}
                </span>
              {/if}
            </span>
          </span>
        </button>
      {/each}
    {/if}
  </div>
</div>
