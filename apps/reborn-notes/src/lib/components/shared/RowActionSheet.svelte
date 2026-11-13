<script lang="ts">
  import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import type { RowAction } from '$lib/utils/row-action';

  /**
   * Phone form of a row's action menu: a bottom sheet listing the same
   * `RowAction[]` the desktop kebab and right-click menu render, so the three
   * can't drift. Choosing an item closes the sheet first, then runs it.
   */
  let {
    open = $bindable(false),
    title,
    hint,
    actions
  }: {
    open: boolean;
    /** Name of the row the actions apply to (user content - isolated with bdi). */
    title: string;
    /** Optional note above the actions (e.g. why the list is short). */
    hint?: string;
    actions: RowAction[];
  } = $props();
</script>

<Sheet bind:open>
  <SheetContent side="bottom" class="h-auto">
    <SheetHeader>
      <SheetTitle><bdi>{title}</bdi></SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
      {#if hint}
        <p class="px-3 pb-2 text-sm text-muted-foreground">{hint}</p>
      {/if}
      {#each actions as { key, icon: Icon, label, run, destructive } (key)}
        <Button
          variant="ghost"
          class="w-full justify-start {destructive
            ? 'text-destructive hover:text-destructive'
            : ''}"
          onclick={(e: Event) => {
            open = false;
            run(e);
          }}
        >
          <Icon class="me-2 h-4 w-4" />
          {label}
        </Button>
      {/each}
    </div>
  </SheetContent>
</Sheet>
