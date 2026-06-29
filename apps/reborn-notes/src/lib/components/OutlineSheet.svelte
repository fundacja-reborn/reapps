<script lang="ts">
  import { ListTree, Pin } from '@lucide/svelte';
  import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import type { DocHeading } from '$lib/utils/heading-outline';
  import OutlineTree from './OutlineTree.svelte';

  let {
    content,
    open,
    activeSlug = null,
    onnavigate,
    onclose,
    showPin = false,
    onpin
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
    /** Show the "pin" affordance (desktop only) that docks the outline beside the editor. */
    showPin?: boolean;
    /** Dock the outline (sets the global pinned preference). */
    onpin?: () => void;
  } = $props();

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onclose();
  }
</script>

<Sheet {open} onOpenChange={handleOpenChange}>
  <SheetContent
    side="right"
    overlayClass="bg-black/20"
    class="flex w-80 flex-col gap-0 p-0 sm:max-w-sm"
  >
    <SheetHeader class="shrink-0 border-b px-4 py-3">
      <div class="flex items-center gap-2">
        <SheetTitle class="flex items-center gap-2 text-sm">
          <ListTree class="h-4 w-4 text-muted-foreground" />
          {$t('outline.title')}
        </SheetTitle>
        {#if showPin}
          <button
            type="button"
            onclick={onpin}
            title={$t('outline.pin')}
            aria-label={$t('outline.pin')}
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground
                   transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Pin class="h-4 w-4" />
          </button>
        {/if}
      </div>
    </SheetHeader>

    <OutlineTree {content} {activeSlug} {onnavigate} enabled={open} />
  </SheetContent>
</Sheet>
