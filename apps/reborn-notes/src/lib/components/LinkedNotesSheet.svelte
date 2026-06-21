<script lang="ts">
  import { Waypoints, ArrowDownLeft, ArrowUpRight, Loader2 } from '@lucide/svelte';
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
  }

  /** Resolve ids → titles via NoteIndex; drop unknown / trashed notes, sort by title. */
  function resolve(ids: string[]): LinkItem[] {
    const out: LinkItem[] = [];
    for (const id of ids) {
      const entry = noteIndex.get(id);
      if (!entry || entry.isArchived) continue;
      out.push({ id, title: entry.title || $t('notes.untitled') });
    }
    out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return out;
  }

  const backlinks = $derived(open ? resolve(noteLinkGraph.incomingIds(noteId)) : []);
  const outgoing = $derived(open ? resolve(noteLinkGraph.outgoingIds(noteId)) : []);
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
        <!-- Backlinks (incoming) -->
        <section>
          <h3
            class="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <ArrowDownLeft class="h-3.5 w-3.5" />
            {$t('linked_notes.incoming')}
            <span
              class="ml-auto rounded bg-background px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
            >{backlinks.length}</span>
          </h3>
          {#if backlinks.length === 0}
            <p class="px-4 py-3 text-sm text-muted-foreground">
              {$t('linked_notes.incoming_empty')}
            </p>
          {:else}
            <ul>
              {#each backlinks as item (item.id)}
                <li>
                  <button
                    type="button"
                    onclick={() => onnavigate(item.id)}
                    class="block w-full truncate px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/50 active:bg-accent"
                  >
                    {item.title}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <!-- Outgoing (clear empty-row gap above, fully bordered band) -->
        <section class="mt-6">
          <h3
            class="sticky top-0 z-10 flex items-center gap-2 border-y bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <ArrowUpRight class="h-3.5 w-3.5" />
            {$t('linked_notes.outgoing')}
            <span
              class="ml-auto rounded bg-background px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
            >{outgoing.length}</span>
          </h3>
          {#if outgoing.length === 0}
            <p class="px-4 py-3 text-sm text-muted-foreground">
              {$t('linked_notes.outgoing_empty')}
            </p>
          {:else}
            <ul>
              {#each outgoing as item (item.id)}
                <li>
                  <button
                    type="button"
                    onclick={() => onnavigate(item.id)}
                    class="block w-full truncate px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/50 active:bg-accent"
                  >
                    {item.title}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    </div>
  </SheetContent>
</Sheet>
