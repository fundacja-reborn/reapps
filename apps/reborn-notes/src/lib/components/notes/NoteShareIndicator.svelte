<script lang="ts">
  import { Share2 } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { sharesBySourceId } from '$lib/stores/shares.store';
  import { requireActiveSession } from '$lib/utils/require-active-session';
  import ManageSharesDialog from './ManageSharesDialog.svelte';

  let {
    noteId,
    onCreateNew
  }: {
    noteId: string | null;
    /** Callback to open the create-share dialog (reuses the existing one in +page). */
    onCreateNew?: () => void;
  } = $props();

  let dialogOpen = $state(false);

  const count = $derived.by(() => {
    if (!noteId) return 0;
    return $sharesBySourceId.get(noteId)?.length ?? 0;
  });

  async function handleClick() {
    // Capture count at click time. We don't re-read after the await: the user's
    // intent was determined when they clicked (view vs. create), and re-reading
    // the reactive count could pick a different branch if a sync arrived during
    // the gate.
    const hadShares = count > 0;
    const reason = hadShares ? 'share.session_required.view' : 'share.session_required.create';
    const ok = await requireActiveSession({ description: $t(reason) });
    if (!ok) return;
    if (hadShares) {
      dialogOpen = true;
    } else {
      onCreateNew?.();
    }
  }

  async function handleCreateNew() {
    dialogOpen = false;
    const ok = await requireActiveSession({
      description: $t('share.session_required.create')
    });
    if (!ok) return;
    onCreateNew?.();
  }
</script>

{#if noteId}
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

  <!-- Always mounted (gated by dialogOpen) so that a sync arriving mid-creation
       cannot dynamically mount this dialog and cover the success view inside
       ShareNoteDialog. -->
  <ManageSharesDialog bind:open={dialogOpen} sourceId={noteId} onCreateNew={handleCreateNew} />
{/if}
