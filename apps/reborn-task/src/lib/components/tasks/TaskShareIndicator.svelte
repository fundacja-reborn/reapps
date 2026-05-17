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

  function handleClick() {
    if (count > 0) {
      dialogOpen = true;
    } else {
      onCreateNew?.();
    }
  }

  function handleCreateNew() {
    dialogOpen = false;
    onCreateNew?.();
  }
</script>

{#if taskId}
  <button
    type="button"
    onclick={handleClick}
    class="flex shrink-0 items-center justify-center gap-1 rounded-md text-muted-foreground
           transition-colors hover:bg-accent hover:text-accent-foreground
           {count > 0 ? 'h-7 px-2' : 'h-7 w-7'}"
    title={count > 0
      ? $t('share.indicator.tooltip', { values: { count } })
      : $t('share.indicator.create_tooltip')}
    aria-label={count > 0
      ? $t('share.indicator.aria_label', { values: { count } })
      : $t('share.indicator.create_tooltip')}
  >
    <Share2 class="h-4 w-4" />
    {#if count > 0}
      <span class="text-xs tabular-nums">{count}</span>
    {/if}
  </button>

  {#if count > 0}
    <ManageSharesDialog bind:open={dialogOpen} sourceId={taskId} onCreateNew={handleCreateNew} />
  {/if}
{/if}
