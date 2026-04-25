<script lang="ts">
  import { Folder, ChevronRight } from '@lucide/svelte';
  import type { FolderWithChildren } from '@reborn/types';
  import { t } from '$lib/stores/i18n.store';

  let {
    subfolders,
    onselect
  }: {
    subfolders: FolderWithChildren[];
    onselect: (id: string) => void;
  } = $props();
</script>

{#if subfolders.length > 0}
  <div class="mb-3 flex flex-col gap-1">
    <h2
      class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      {$t('folders.subfolders')}
    </h2>
    <ul class="flex flex-col gap-1" role="list">
      {#each subfolders as folder (folder.id)}
        <li>
          <div
            role="button"
            tabindex="0"
            class="group flex cursor-pointer items-center gap-2 rounded-lg p-3 text-sm transition-colors hover:bg-accent/50"
            onclick={() => onselect(folder.id)}
            onkeydown={(e) => e.key === 'Enter' && onselect(folder.id)}
          >
            <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate">{folder.name}</span>
            <ChevronRight
              class="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
            />
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/if}
