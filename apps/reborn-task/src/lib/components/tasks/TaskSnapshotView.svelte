<script lang="ts">
  import { Card } from '@reborn/ui';
  import { CheckCircle2, Circle, Star } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import type { SharedSnapshotTaskPayload } from '@reborn/types';

  let { payload, showHeader = true }: { payload: SharedSnapshotTaskPayload; showHeader?: boolean } = $props();

  const meta = $derived(payload.metadata as
    | { due_date?: string | null; has_time?: boolean; is_completed?: boolean; is_starred?: boolean }
    | undefined);

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
</script>

{#if showHeader}
  <div class="flex items-start gap-3">
    {#if meta?.is_completed}
      <CheckCircle2 class="mt-1 h-5 w-5 shrink-0 text-green-600" />
    {:else}
      <Circle class="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
    {/if}
    <h1 class="flex-1 text-2xl font-semibold leading-tight" class:line-through={meta?.is_completed}>
      {payload.title || $t('share.view.untitled')}
    </h1>
    {#if meta?.is_starred}
      <Star class="mt-1 h-5 w-5 shrink-0 fill-yellow-400 text-yellow-400" />
    {/if}
  </div>

  <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
    {#if payload.shared_by_label}
      <span>{$t('share.view.shared_by', { values: { label: payload.shared_by_label } })}</span>
    {/if}
    <span>{$t('share.view.shared_at', { values: { relative: formatDate(payload.shared_at) } })}</span>
    {#if meta?.due_date}
      <span>· {$t('share.view.task.due_date_label')}: {formatDate(meta.due_date)}</span>
    {/if}
    {#if meta?.is_completed}
      <span>· {$t('share.view.task.completed_badge')}</span>
    {/if}
  </div>
{/if}

{#if payload.description}
  <Card class="p-4">
    <p class="whitespace-pre-wrap text-sm">{payload.description}</p>
  </Card>
{:else}
  <p class="text-xs italic text-muted-foreground">{$t('share.view.task.no_description')}</p>
{/if}

<section class="flex flex-col gap-2">
  <h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
    {$t('share.view.task.subtasks_label')}
  </h2>
  {#if payload.subtasks.length === 0}
    <p class="text-xs italic text-muted-foreground">{$t('share.view.task.no_subtasks')}</p>
  {:else}
    <ul class="flex flex-col gap-1">
      {#each payload.subtasks as subtask, i (i)}
        {@const completed = (subtask.metadata as { is_completed?: boolean } | undefined)?.is_completed}
        <li class="flex items-start gap-2 text-sm">
          <input type="checkbox" disabled checked={completed} class="mt-0.5" />
          <span class:line-through={completed} class:text-muted-foreground={completed}>
            {subtask.name}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
