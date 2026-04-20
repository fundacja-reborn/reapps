<script lang="ts">
  import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { foldersStore } from '$lib/stores/folders.store';
  import { flattenFoldersWithDepth } from '$lib/utils/folder-helpers';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';

  let {
    noteId,
    open = $bindable(false),
    onmove
  }: {
    noteId: string | null;
    open: boolean;
    onmove: (noteId: string, folderId: string | null, e?: Event) => void;
  } = $props();

  const isMobileQuery = useIsMobile();
  const allFolders = $derived(flattenFoldersWithDepth($foldersStore));
</script>

<!-- Desktop: absolute popup (rendered by parent inside the note item) -->
{#if !isMobileQuery.value && noteId}
  <div
    class="absolute right-0 top-7 z-50 min-w-44 rounded-md border bg-popover py-1 shadow-md"
    role="menu"
    aria-label={$t('notes.move_to')}
  >
    <p
      class="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      {$t('notes.move_to')}
    </p>
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
      role="menuitem"
      onclick={(e) => onmove(noteId, null, e)}
    >
      {$t('notes.no_folder')}
    </button>
    {#if allFolders.length > 0}
      <div class="my-1 border-t"></div>
      {#each allFolders as folder (folder.id)}
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
          role="menuitem"
          style="padding-left: {folder.depth * 0.75 + 0.75}rem"
          onclick={(e) => onmove(noteId, folder.id, e)}
        >
          {folder.name}
        </button>
      {/each}
    {/if}
  </div>
{/if}

<!-- Mobile: bottom sheet -->
<Sheet bind:open>
  <SheetContent side="bottom" class="h-auto max-h-[60dvh] overflow-y-auto">
    <SheetHeader>
      <SheetTitle>{$t('notes.move_to')}</SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
      <Button
        variant="ghost"
        class="w-full justify-start"
        onclick={() => noteId && onmove(noteId, null)}
      >
        {$t('notes.no_folder')}
      </Button>
      {#if allFolders.length > 0}
        {#each allFolders as folder (folder.id)}
          <Button
            variant="ghost"
            class="w-full justify-start"
            style="padding-left: {folder.depth * 0.75 + 0.75}rem"
            onclick={() => noteId && onmove(noteId, folder.id)}
          >
            {folder.name}
          </Button>
        {/each}
      {/if}
    </div>
  </SheetContent>
</Sheet>
