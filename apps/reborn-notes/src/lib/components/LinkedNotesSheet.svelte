<script lang="ts">
  import { Waypoints, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Loader2 } from '@lucide/svelte';
  import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { noteLinkGraph } from '$lib/services/note-link-graph.svelte';
  import { noteIndex } from '$lib/services/note-index.svelte';
  import { t } from '$lib/stores/i18n.store';

  let {
    noteId,
    open,
    onnavigate,
    onclose
  }: {
    noteId: string;
    open: boolean;
    /** Navigate to a linked note (parent decides whether to also close on mobile). */
    onnavigate: (noteId: string) => void;
    onclose: () => void;
  } = $props();

  // Lazy-build the graph when the panel opens. Reading isBuilt/isBuilding keeps
  // this reactive, so it also recovers if the graph was invalidated (sync /
  // import) while the panel stayed open.
  $effect(() => {
    if (open && !noteLinkGraph.isBuilt && !noteLinkGraph.isBuilding) {
      void noteLinkGraph.ensureBuilt();
    }
  });

  interface LinkItem {
    id: string;
    title: string;
    /** Link target whose note no longer exists (deleted) - shown disabled. */
    missing: boolean;
  }

  /**
   * Resolve ids → titles via NoteIndex. Trashed (archived) notes stay hidden;
   * ids with no index entry are surfaced as `missing` (broken link) rather than
   * silently dropped. Missing rows sort last, the rest by title.
   */
  function resolve(ids: string[]): LinkItem[] {
    const out: LinkItem[] = [];
    for (const id of ids) {
      const entry = noteIndex.get(id);
      if (entry?.isArchived) continue;
      if (!entry) {
        out.push({ id, title: $t('linked_notes.missing'), missing: true });
      } else {
        out.push({ id, title: entry.title || $t('notes.untitled'), missing: false });
      }
    }
    out.sort((a, b) => {
      if (a.missing !== b.missing) return a.missing ? 1 : -1;
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
    return out;
  }

  const backlinks = $derived(open ? resolve(noteLinkGraph.incomingIds(noteId)) : []);
  const outgoing = $derived(open ? resolve(noteLinkGraph.outgoingIds(noteId)) : []);
  /** Ids linked both ways - badged "↔" in both lists. Cheap; computed unconditionally. */
  const mutual = $derived(noteLinkGraph.mutualIds(noteId));
  const loading = $derived(open && !noteLinkGraph.isBuilt);
  const isEmpty = $derived(
    open && noteLinkGraph.isBuilt && backlinks.length === 0 && outgoing.length === 0
  );

  // Build progress - only meaningful while the first build runs on a large vault.
  const progress = $derived(noteLinkGraph.buildProgress);
  const progressPct = $derived(
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  );

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onclose();
  }
</script>

{#snippet linkRow(item: LinkItem)}
  <!-- No dividers: rows are separated by spacing + an inset, rounded hover.
       Every row reserves a fixed-width trailing slot (w-6) so the "↔" badges
       form a clean column and the title's ellipsis never runs under the icon.
       The button is inset 8px (ul px-2) so its hover is inset + rounded; text
       lands at 16px from the panel edge (aligned with the section header), and
       the slot ends 16px from the right (matching the left inset). -->
  <li>
    {#if item.missing}
      <div
        class="flex w-full items-center gap-2 rounded-lg px-2 py-2"
        title={$t('linked_notes.missing')}
      >
        <span class="min-w-0 flex-1 truncate text-sm italic text-muted-foreground/50"
          >{$t('linked_notes.missing')}</span
        >
        <span class="w-6 shrink-0" aria-hidden="true"></span>
      </div>
    {:else}
      <button
        type="button"
        onclick={() => onnavigate(item.id)}
        title={item.title}
        aria-label={mutual.has(item.id)
          ? `${item.title}, ${$t('linked_notes.mutual')}`
          : undefined}
        class="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent"
      >
        <span
          class="min-w-0 flex-1 truncate text-sm text-muted-foreground transition-colors group-hover:text-foreground"
          >{item.title}</span
        >
        <span class="flex w-6 shrink-0 items-center justify-center">
          {#if mutual.has(item.id)}
            <span title={$t('linked_notes.mutual')} class="text-muted-foreground/70">
              <ArrowLeftRight class="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          {/if}
        </span>
      </button>
    {/if}
  </li>
{/snippet}

<Sheet {open} onOpenChange={handleOpenChange}>
  <SheetContent side="right" class="flex w-80 flex-col gap-0 p-0 sm:max-w-sm">
    <SheetHeader class="shrink-0 border-b px-4 py-3">
      <SheetTitle class="flex items-center gap-2 text-sm">
        <Waypoints class="h-4 w-4 text-muted-foreground" />
        {$t('linked_notes.title')}
      </SheetTitle>
    </SheetHeader>

    <div class="flex-1 overflow-y-auto">
      {#if loading}
        <div
          class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-sm text-muted-foreground"
        >
          <Loader2 class="h-5 w-5 animate-spin" />
          <span>{$t('linked_notes.loading')}</span>
          {#if progress.total > 0}
            <div class="w-full max-w-[12rem]">
              <div class="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full bg-primary transition-[width] duration-200"
                  style="width: {progressPct}%"
                ></div>
              </div>
              <div class="mt-1.5 text-center text-xs tabular-nums">
                {progress.done} / {progress.total}
              </div>
            </div>
          {/if}
        </div>
      {:else if isEmpty}
        <div
          class="flex items-center justify-center px-4 py-12 text-center text-sm text-muted-foreground"
        >
          {$t('linked_notes.empty')}
        </div>
      {:else}
        <!-- Backlinks (incoming). Header: bold/uppercase type, no gray band
             (opaque bg-background only so the sticky label stays readable). -->
        <section aria-labelledby="linked-notes-incoming">
          <h3
            id="linked-notes-incoming"
            class="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-foreground/80"
          >
            <ArrowDownLeft class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            {$t('linked_notes.incoming')}
            <span
              class="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
              aria-label={$t('linked_notes.incoming_count', {
                values: { count: backlinks.length }
              })}>{backlinks.length}</span
            >
          </h3>
          {#if backlinks.length === 0}
            <p class="px-4 py-3 text-sm text-muted-foreground">
              {$t('linked_notes.incoming_empty')}
            </p>
          {:else}
            <ul role="list" aria-labelledby="linked-notes-incoming" class="space-y-0.5 px-2 py-1">
              {#each backlinks as item (item.id)}
                {@render linkRow(item)}
              {/each}
            </ul>
          {/if}
        </section>

        <!-- Outgoing (clear empty-row gap above). -->
        <section class="mt-6" aria-labelledby="linked-notes-outgoing">
          <h3
            id="linked-notes-outgoing"
            class="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-foreground/80"
          >
            <ArrowUpRight class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            {$t('linked_notes.outgoing')}
            <span
              class="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
              aria-label={$t('linked_notes.outgoing_count', {
                values: { count: outgoing.length }
              })}>{outgoing.length}</span
            >
          </h3>
          {#if outgoing.length === 0}
            <p class="px-4 py-3 text-sm text-muted-foreground">
              {$t('linked_notes.outgoing_empty')}
            </p>
          {:else}
            <ul role="list" aria-labelledby="linked-notes-outgoing" class="space-y-0.5 px-2 py-1">
              {#each outgoing as item (item.id)}
                {@render linkRow(item)}
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    </div>
  </SheetContent>
</Sheet>
