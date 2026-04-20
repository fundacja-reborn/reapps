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
  import { t } from '$lib/stores/i18n.store';
  import { notesStore, type SortBy } from '$lib/stores/notes.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';

  let {
    sortSheetOpen = $bindable(false)
  }: {
    sortSheetOpen: boolean;
  } = $props();

  const isMobileQuery = useIsMobile();
  const sortByStore = notesStore.sortBy;

  const SORT_OPTIONS: { value: SortBy; label: string }[] = $derived([
    { value: 'updated_at', label: $t('notes.sort.last_modified') },
    { value: 'created_at', label: $t('notes.sort.date_created') },
    { value: 'title', label: $t('notes.sort.title_az') }
  ]);

  function handleSortSelect(sort: SortBy) {
    notesStore.setSort(sort);
    sortSheetOpen = false;
  }
</script>

{#if isMobileQuery.value}
  <button
    type="button"
    onclick={() => (sortSheetOpen = true)}
    title={$t('notes.sort_notes')}
    aria-label={$t('notes.sort_notes')}
    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
  >
    <ArrowDownUp class="h-4 w-4" />
  </button>
{:else}
  <DropdownMenu>
    <DropdownMenuTrigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          title={$t('notes.sort_notes')}
          aria-label={$t('notes.sort_notes')}
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowDownUp class="h-4 w-4" />
        </button>
      {/snippet}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-44">
      <p
        class="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {$t('notes.sort_notes')}
      </p>
      {#each SORT_OPTIONS as option (option.value)}
        <DropdownMenuItem
          class={$sortByStore === option.value
            ? 'font-medium text-foreground'
            : 'text-muted-foreground'}
          onclick={() => handleSortSelect(option.value)}
        >
          {option.label}
          {#if $sortByStore === option.value}
            <span class="ml-auto text-primary">✓</span>
          {/if}
        </DropdownMenuItem>
      {/each}
    </DropdownMenuContent>
  </DropdownMenu>
{/if}

<!-- Mobile: Sort Sheet -->
<Sheet bind:open={sortSheetOpen}>
  <SheetContent side="bottom" class="h-auto">
    <SheetHeader>
      <SheetTitle>{$t('notes.sort_notes')}</SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
      {#each SORT_OPTIONS as option (option.value)}
        <Button
          variant={$sortByStore === option.value ? 'secondary' : 'ghost'}
          class="w-full justify-start"
          onclick={() => handleSortSelect(option.value)}
        >
          {option.label}
        </Button>
      {/each}
    </div>
  </SheetContent>
</Sheet>
