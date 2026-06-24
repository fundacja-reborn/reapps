<script lang="ts">
  import { ListTree } from '@lucide/svelte';
  import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { extractHeadings, type DocHeading } from '$lib/utils/heading-outline';

  interface OutlineNode extends DocHeading {
    children: OutlineNode[];
  }

  let {
    content,
    open,
    activeSlug = null,
    onnavigate,
    onclose
  }: {
    /** Raw Markdown of the open note - the outline is derived from its headings. */
    content: string;
    open: boolean;
    /**
     * Slug of the heading currently scrolled into view in the preview
     * (scroll-spy, computed by the page). Highlighted and kept on screen.
     */
    activeSlug?: string | null;
    /** Jump to a heading (the page scrolls the preview or the editor). */
    onnavigate: (heading: DocHeading) => void;
    onclose: () => void;
  } = $props();

  // Build a nesting tree from the flat heading list so each level can draw its
  // own indent guide (a `border-left` on the nested <ul>). Headings may skip a
  // level (H2 -> H4); a deeper heading just nests under the nearest shallower
  // ancestor still on the stack.
  const tree = $derived.by<OutlineNode[]>(() => {
    if (!open || !content) return [];
    const roots: OutlineNode[] = [];
    const stack: OutlineNode[] = [];
    for (const h of extractHeadings(content)) {
      const node: OutlineNode = { ...h, children: [] };
      while (stack.length && stack[stack.length - 1].depth >= h.depth) stack.pop();
      (stack.length ? stack[stack.length - 1].children : roots).push(node);
      stack.push(node);
    }
    return roots;
  });

  const isEmpty = $derived(open && tree.length === 0);

  let listEl = $state<HTMLElement | null>(null);

  // Keep the active (scroll-spied) entry visible, without yanking the panel when
  // it is already on screen (`block: 'nearest'` is a no-op if in view).
  $effect(() => {
    const slug = activeSlug;
    if (!slug || !listEl) return;
    listEl.querySelector(`[data-slug="${slug}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  // Split a heading into plain / inline-code segments so `code` in a heading
  // renders monospace instead of showing literal backticks.
  function segments(text: string): { code: boolean; text: string }[] {
    return text
      .split('`')
      .map((part, i) => ({ code: i % 2 === 1, text: part }))
      .filter((s) => s.text !== '');
  }

  // Font / size / colour gradation by nesting level (not raw depth, so a doc
  // that starts at ## is treated as level 0).
  function levelClass(level: number): string {
    if (level === 0) return 'font-semibold text-foreground';
    if (level === 1) return 'text-foreground';
    return 'text-[0.92em] text-muted-foreground';
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onclose();
  }
</script>

{#snippet rows(nodes: OutlineNode[], level: number)}
  <ul class="m-0 list-none p-0 {level > 0 ? 'ml-[0.6rem] border-l border-border/40 pl-1' : ''}">
    {#each nodes as node (node.slug)}
      {@const active = node.slug === activeSlug}
      <li>
        <button
          type="button"
          data-slug={node.slug}
          onclick={() => onnavigate(node)}
          title={node.text}
          aria-current={active ? 'location' : undefined}
          class="flex w-full cursor-pointer rounded-md px-2 py-1 text-left leading-[1.35] transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent
            {levelClass(level)}
            {active ? 'font-medium text-primary shadow-[inset_2px_0_0_0_var(--primary)]' : ''}"
        >
          <span class="line-clamp-2 min-w-0 flex-1 text-sm"
            >{#each segments(node.text) as seg, i (i)}{#if seg.code}<code
                  class="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{seg.text}</code
                >{:else}{seg.text}{/if}{/each}</span
          >
        </button>
        {#if node.children.length}{@render rows(node.children, level + 1)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<Sheet {open} onOpenChange={handleOpenChange}>
  <SheetContent
    side="right"
    overlayClass="bg-black/20"
    class="flex w-80 flex-col gap-0 p-0 sm:max-w-sm"
  >
    <SheetHeader class="shrink-0 border-b px-4 py-3">
      <SheetTitle class="flex items-center gap-2 text-sm">
        <ListTree class="h-4 w-4 text-muted-foreground" />
        {$t('outline.title')}
      </SheetTitle>
    </SheetHeader>

    <div bind:this={listEl} class="flex-1 overflow-y-auto px-2 py-1.5">
      {#if isEmpty}
        <div
          class="flex items-center justify-center px-4 py-12 text-center text-sm text-muted-foreground"
        >
          {$t('outline.empty')}
        </div>
      {:else}
        {@render rows(tree, 0)}
      {/if}
    </div>
  </SheetContent>
</Sheet>
