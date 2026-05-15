<script lang="ts">
  import { Share2 } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { sharesBySourceId } from '$lib/stores/shares.store';
  import ManageSharesDialog from './ManageSharesDialog.svelte';

  let {
    taskId,
    onCreateNew
  }: {
    taskId: string | null;
    onCreateNew?: () => void;
  } = $props();

  let dialogOpen = $state(false);

  const count = $derived.by(() => {
    if (!taskId) return 0;
    return $sharesBySourceId.get(taskId)?.length ?? 0;
  });
</script>

{#if count > 0 && taskId}
  <button
    type="button"
    onclick={() => (dialogOpen = true)}
    class="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-md border border-border/60
           bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground select-none
           transition-colors hover:bg-muted hover:text-foreground"
    title={$t('share.indicator.tooltip', { values: { count } })}
    aria-label={$t('share.indicator.aria_label', { values: { count } })}
  >
    <Share2 class="h-3.5 w-3.5 md:h-3 md:w-3" />
    <span class="hidden sm:inline">
      {$t('share.indicator.label', { values: { count } })}
    </span>
    <span class="tabular-nums">{count}</span>
  </button>

  <ManageSharesDialog bind:open={dialogOpen} sourceId={taskId} {onCreateNew} />
{/if}
