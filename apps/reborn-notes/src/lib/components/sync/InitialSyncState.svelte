<!--
  @component
  Loading placeholder shown in the main content area during the very first
  sync after a fresh login (IndexedDB empty). Replaces the standard
  "select or create a note" empty state so users don't think their notes
  were lost while data is being fetched and decrypted.

  Uses an internal 300ms delay to avoid flicker on fast syncs.
-->
<script lang="ts">
  import { LoadingSpinner, Skeleton } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';

  let { compact = false }: { compact?: boolean } = $props();

  // Anti-flicker: only render the visible state after 300ms.
  // Below that threshold a fast sync would cause a jarring flash.
  let showAfterDelay = $state(false);

  $effect(() => {
    const timer = setTimeout(() => {
      showAfterDelay = true;
    }, 300);
    return () => clearTimeout(timer);
  });
</script>

{#if showAfterDelay}
  <div
    class="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-muted-foreground"
    role="status"
    aria-live="polite"
  >
    <div class="flex flex-col items-center gap-3 text-center">
      <LoadingSpinner size="lg" class="text-primary" />
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium text-foreground">
          {$t('sync_status.initial.title')}
        </p>
        <p class="text-xs opacity-70 max-w-sm">
          {$t('sync_status.initial.message')}
        </p>
      </div>
    </div>

    {#if !compact}
      <div class="w-full max-w-md flex flex-col gap-3" aria-hidden="true">
        {#each Array(4) as _, i (i)}
          <div class="flex flex-col gap-2 rounded-md border border-border/40 p-3">
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-3 w-full" />
            <Skeleton class="h-3 w-4/5" />
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
