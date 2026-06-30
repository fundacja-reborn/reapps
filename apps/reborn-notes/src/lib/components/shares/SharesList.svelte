<script lang="ts">
  import { RefreshCw, AlertTriangle, Lock, ArrowDownUp, Search, X, Clock } from '@lucide/svelte';
  import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
  } from '@reborn/ui';
  import { t, locale } from '$lib/stores/i18n.store';
  import { activeShares, activeShareId, sharesBySourceId, sharesStore } from '$lib/stores/shares.store';
  import { formatExpiryRelative } from '$lib/utils/expiry-format';
  import type { OwnShareListItem } from '@reborn/types';

  // One row per active share LINK (flat list). A note shared more than once shows
  // one row per snapshot, distinguished by its creation date and a "k/n" ordinal
  // pill ("snapshot k of n for this note"). k is the snapshot's 1-based position
  // by created_at (stable across list re-sorts); n is the note's total active
  // snapshot count - so two rows with the same title are no longer ambiguous.
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

  // Full date + time - matches ShareDetailPanel's "Created" field. Used as the
  // row tooltip so the compact date-only label still exposes the exact moment.
  function formatDateTime(iso: string | null): string {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }

  function formatOpens(s: OwnShareListItem): string {
    return s.max_access_count !== null
      ? `${s.access_count} / ${s.max_access_count}`
      : String(s.access_count);
  }

  // Ordinal position of this snapshot among all active shares of the same source
  // note: k = 1-based rank by created_at (oldest = 1), n = total snapshots for the
  // note (same source as the former "N links" pill - presentation change only).
  // k is derived from created_at alone, NOT the list's current sort, so badge
  // numbers stay stable when the user re-sorts; id breaks created_at ties so every
  // sibling keeps a distinct, stable k.
  function snapshotRankFor(s: OwnShareListItem): { k: number; n: number } {
    const src = decoded[s.id]?.payload.source_id;
    const siblings = src ? $sharesBySourceId.get(src) : undefined;
    const n = siblings?.length ?? 1;
    if (!siblings || n < 2) return { k: 1, n };
    const ordered = [...siblings].sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return da !== db ? da - db : a.id.localeCompare(b.id);
    });
    const k = ordered.findIndex((x) => x.id === s.id) + 1;
    return { k: k || 1, n };
  }

  const SORT_OPTIONS: { value: ShareSort; label: string }[] = $derived([
    { value: 'created', label: $t('share.list.sort.created') },
    { value: 'expires', label: $t('share.list.sort.expires') },
    { value: 'opens', label: $t('share.list.sort.opens') },
    { value: 'title', label: $t('share.list.sort.title') }
  ]);
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Header mirrors NoteList: row 1 = title, row 2 = count + actions, then
       search. Row 1 grows by the iOS notch inset on mobile (where this list owns
       the panel header) and is compact h-10 on desktop. -->
  <div
    class="flex shrink-0 items-center gap-1 px-4 md:px-5
           min-h-[calc(3.5rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)]
           md:min-h-0 md:h-10 md:pt-0"
  >
    <h1
      class="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight md:text-sm md:font-normal md:tracking-normal"
    >
      {$t('share.list.title')}
    </h1>
  </div>

  <!-- Row 2 (meta): count + sort + refresh. Mobile sits mt-2 below the app-bar
       (h-11 tap targets define its height); desktop stays the compact h-10 / h-9
       band - same rhythm as NoteList's meta row. -->
  <div class="flex shrink-0 items-center gap-1 mt-2 px-4 md:mt-0 md:h-10 md:px-5">
    <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
      {$t('share.list.count', { values: { count: rows.length } })}
    </span>

    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            title={$t('share.list.sort_label')}
            aria-label={$t('share.list.sort_label')}
            class="flex h-11 w-11 md:h-9 md:w-9 shrink-0 items-center justify-center rounded-md
                   text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowDownUp class="h-5 w-5 md:h-4 md:w-4" />
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
      class="flex h-11 w-11 md:h-9 md:w-9 shrink-0 items-center justify-center rounded-md
             text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground
             disabled:pointer-events-none disabled:opacity-50"
    >
      <RefreshCw class="h-5 w-5 md:h-4 md:w-4 {isLoading ? 'animate-spin' : ''}" />
    </button>
  </div>

  <!-- Search (matches NoteListSearchBar): mobile px-4 + mt-2, desktop px-3. -->
  <div class="shrink-0 px-4 pb-2 md:px-3 mt-2 md:mt-0">
    <div class="relative">
      <Search
        class="absolute left-2.5 top-1/2 h-4 w-4 md:h-3.5 md:w-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="text"
        placeholder={$t('share.list.search_placeholder')}
        bind:value={searchInput}
        class="w-full rounded-md border bg-background py-2.5 md:py-2 pl-8 md:pl-7 pr-10 md:pr-8 text-sm md:text-xs
               focus:outline-none focus:ring-1 focus:ring-primary"
        aria-label={$t('share.list.search_placeholder')}
      />
      {#if searchInput}
        <button
          type="button"
          onclick={() => (searchInput = '')}
          class="absolute right-1 top-1/2 -translate-y-1/2 flex h-9 w-9 md:h-7 md:w-7 items-center justify-center
                 text-muted-foreground hover:text-foreground"
          aria-label={$t('notes.clear_search')}
        >
          <X class="h-4 w-4 md:h-3.5 md:w-3.5" />
        </button>
      {/if}
    </div>
  </div>

  <!-- List -->
  <div class="flex-1 overflow-y-auto px-3">
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
      <ul class="flex flex-col gap-2 py-1" role="list">
        {#each rows as share (share.id)}
          {@const title = titleOf(share)}
          {@const expiringSoon = isExpiringSoon(share)}
          {@const rank = snapshotRankFor(share)}
          {@const expRel = share.expires_at ? formatExpiryRelative(share.expires_at, $locale ?? 'en') : null}
          <li>
            <button
              type="button"
              onclick={() => activeShareId.set(share.id)}
              class="note-item-bg group flex w-full cursor-pointer items-start gap-2 rounded-lg p-4 md:p-3 text-left transition-colors
                {$activeShareId === share.id ? 'list-row-active text-accent-foreground' : ''}"
              aria-current={$activeShareId === share.id ? 'true' : undefined}
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-start gap-1">
                  <p class="min-w-0 flex-1 line-clamp-2 text-base md:text-sm font-normal leading-snug text-foreground">
                    {title || $t('share.list.untitled')}
                  </p>
                  {#if share.has_password}
                    <Lock
                      class="mt-1.5 h-3.5 w-3.5 md:mt-1 md:h-3 md:w-3 shrink-0 text-muted-foreground"
                      aria-label={$t('share.list.password_protected')}
                    />
                  {/if}
                </div>
                <div
                  class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] md:text-xs text-muted-foreground"
                >
                  {#if expiringSoon}
                    <span class="inline-flex items-center gap-0.5 font-medium text-amber-600 dark:text-amber-400">
                      <Clock class="h-3 w-3" />{$t('share.list.expiring_soon')}
                    </span>
                  {/if}
                  <span title={formatDateTime(share.created_at)}
                    >{$t('share.list.column.created')}: {formatDate(share.created_at)}</span
                  >
                  <span aria-hidden="true">·</span>
                  <span
                    >{$t('share.list.column.expires')}: {share.expires_at
                      ? formatDate(share.expires_at)
                      : $t('share.create.expires.never')}{#if expRel && !expRel.expired} ({expRel.text}){/if}</span
                  >
                  <span aria-hidden="true">·</span>
                  <span>{$t('share.list.column.access_count')}: {formatOpens(share)}</span>
                  {#if rank.n > 1}
                    {@const rankLabel = $t('share.list.snapshot_rank_label', {
                      values: { k: rank.k, n: rank.n }
                    })}
                    <span
                      class="rounded-full border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      title={rankLabel}
                      aria-label={rankLabel}
                    >
                      {rank.k}/{rank.n}
                    </span>
                  {/if}
                </div>
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
