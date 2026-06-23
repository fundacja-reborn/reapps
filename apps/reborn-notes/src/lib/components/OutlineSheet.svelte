<script lang="ts">
  import { ListTree } from '@lucide/svelte';
  import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { extractHeadings, type DocHeading } from '$lib/utils/heading-outline';

  let {
    content,
    open,
    onnavigate,
    onclose
  }: {
    /** Raw Markdown of the open note - the outline is derived from its headings. */
    content: string;
    open: boolean;
    /** Jump to a heading (parent scrolls the preview or editor, and on mobile closes). */
    onnavigate: (heading: DocHeading) => void;
    onclose: () => void;
  } = $props();

  // Headings of the open note. Computed only while the panel is open. Indent is
  // relative to the shallowest heading present, so a doc that starts at `##`
  // (no top-level `#`) is not over-indented.
  const headings = $derived.by<(DocHeading & { indent: number })[]>(() => {
    if (!open || !content) return [];
    const list = extractHeadings(content);
    if (list.length === 0) return [];
    const minDepth = Math.min(...list.map((h) => h.depth));
    return list.map((h) => ({ ...h, indent: h.depth - minDepth }));
  });

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onclose();
  }
</script>

<Sheet {open} onOpenChange={handleOpenChange}>
  <SheetContent side="right" class="flex w-80 flex-col gap-0 p-0 sm:max-w-sm">
    <SheetHeader class="shrink-0 border-b px-4 py-3">
      <SheetTitle class="flex items-center gap-2 text-sm">
        <ListTree class="h-4 w-4 text-muted-foreground" />
        {$t('outline.title')}
      </SheetTitle>
    </SheetHeader>

    <div class="flex-1 overflow-y-auto py-1">
      {#if headings.length === 0}
        <div
          class="flex items-center justify-center px-4 py-12 text-center text-sm text-muted-foreground"
        >
          {$t('outline.empty')}
        </div>
      {:else}
        <ul role="list" class="space-y-0.5 px-2">
          {#each headings as heading (heading.slug)}
            <li>
              <button
                type="button"
                onclick={() => onnavigate(heading)}
                title={heading.text}
                style:padding-left={`${0.5 + heading.indent * 0.75}rem`}
                class="group flex w-full cursor-pointer items-center rounded-lg py-1.5 pr-2 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent
                  {heading.indent === 0
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground group-hover:text-foreground'}"
              >
                <span class="min-w-0 flex-1 truncate group-hover:text-foreground">{heading.text}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </SheetContent>
</Sheet>
