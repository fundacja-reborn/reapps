<script lang="ts">
  import { ArrowDownUp } from '@lucide/svelte';
  import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
  } from '@reborn/ui';
  import type { FolderSortMode } from '@reborn/storage';
  import { t } from '$lib/stores/i18n.store';
  import { appSettings, folderSortMode } from '$lib/stores/app-settings.store';
  import { foldersStore } from '$lib/stores/folders.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';

  let {
    prominent = false
  }: {
    /** Larger button/icon sizing to match the mobile prominent header. */
    prominent?: boolean;
  } = $props();

  const isMobileQuery = useIsMobile();

  let sheetOpen = $state(false);

  const buttonSizeClass = $derived(prominent ? 'h-11 w-11' : 'h-7 w-7');
  const iconSizeClass = $derived(prominent ? 'h-5 w-5' : 'h-4 w-4');

  const SORT_OPTIONS: { value: FolderSortMode; label: string }[] = $derived([
    { value: 'alphabetical', label: $t('folders.sort_alphabetical') },
    { value: 'custom', label: $t('folders.sort_custom') }
  ]);

  async function handleSortSelect(mode: FolderSortMode) {
    sheetOpen = false;
    if (mode === $folderSortMode) return;
    // Persist (E2E synced with the app bundle), then re-sort the loaded tree.
    await appSettings.update('folderSortMode', mode);
    await foldersStore.refresh();
  }
</script>

{#if isMobileQuery.value}
  <button
    type="button"
    onclick={() => (sheetOpen = true)}
    title={$t('folders.sort')}
    aria-label={$t('folders.sort')}
    class="flex {buttonSizeClass} shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
  >
    <ArrowDownUp class={iconSizeClass} />
  </button>
{:else}
  <DropdownMenu>
    <DropdownMenuTrigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          title={$t('folders.sort')}
          aria-label={$t('folders.sort')}
          class="flex {buttonSizeClass} shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowDownUp class={iconSizeClass} />
        </button>
      {/snippet}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-44">
      <p
        class="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {$t('folders.sort')}
      </p>
      {#each SORT_OPTIONS as option (option.value)}
        <DropdownMenuItem
          class={$folderSortMode === option.value
            ? 'font-medium text-foreground'
            : 'text-muted-foreground'}
          onclick={() => handleSortSelect(option.value)}
        >
          {option.label}
          {#if $folderSortMode === option.value}
            <span class="ml-auto text-primary">✓</span>
          {/if}
        </DropdownMenuItem>
      {/each}
    </DropdownMenuContent>
  </DropdownMenu>
{/if}

<!-- Mobile: Sort Sheet -->
<Sheet bind:open={sheetOpen}>
  <SheetContent side="bottom" class="h-auto">
    <SheetHeader>
      <SheetTitle>{$t('folders.sort')}</SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
      {#each SORT_OPTIONS as option (option.value)}
        <Button
          variant={$folderSortMode === option.value ? 'secondary' : 'ghost'}
          class="w-full justify-start"
          onclick={() => handleSortSelect(option.value)}
        >
          {option.label}
        </Button>
      {/each}
    </div>
  </SheetContent>
</Sheet>
