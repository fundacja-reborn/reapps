<script lang="ts">
  import { CheckCircle2, Circle } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import type { SharedSnapshotTaskPayload } from '@reborn/types';

  let { payload, showHeader = true }: { payload: SharedSnapshotTaskPayload; showHeader?: boolean } = $props();

  // No type cast needed now that payload.metadata is typed as the minimal
  // SharedSnapshotTaskMetadata - reads its fields directly. (Older code
  // here referenced `is_starred`; that field is no longer in the payload
  // by defense-in-depth design, see SharedSnapshotTaskMetadata.)
  const meta = $derived(payload.metadata);

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
  {@const headline = payload.display_name?.trim() || payload.title || $t('share.view.untitled')}
  <header class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      {#if meta?.is_completed}
        <CheckCircle2 class="h-4 w-4 shrink-0 text-green-600" />
      {:else}
        <Circle class="h-4 w-4 shrink-0 text-muted-foreground" />
      {/if}
      <h1
        class="min-w-0 flex-1 break-words text-sm font-semibold leading-snug text-foreground"
        class:line-through={meta?.is_completed}
      >
        {headline}
      </h1>
    </div>
    <div class="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {#if payload.shared_by_label}
        <span>{$t('share.view.shared_by', { values: { label: payload.shared_by_label } })}</span>
        <span aria-hidden="true">·</span>
      {/if}
      <span>{$t('share.view.shared_at', { values: { relative: formatDate(payload.shared_at) } })}</span>
      {#if meta?.due_date}
        <span aria-hidden="true">·</span>
        <span>{$t('share.view.task.due_date_label')}: {formatDate(meta.due_date)}</span>
      {/if}
      {#if meta?.is_completed}
        <span aria-hidden="true">·</span>
        <span>{$t('share.view.task.completed_badge')}</span>
      {/if}
    </div>
  </header>
{/if}

<!-- Section order: subtasks first, description second - mirrors the in-app
     task detail layout, where the actionable items (subtasks) are surfaced
     above the supplementary description text. Empty sections are omitted
     entirely: the read-only viewer has no "add..." prompts to render, so an
     empty heading would be visual noise. -->
{#if payload.subtasks.length > 0}
  <section class="flex flex-col gap-2">
    <h2 class="text-base font-semibold leading-snug text-foreground">
      {$t('share.view.task.subtasks_label')}
    </h2>
    <ul class="flex flex-col gap-1.5">
      {#each payload.subtasks as subtask, i (i)}
        {@const completed = (subtask.metadata as { is_completed?: boolean } | undefined)?.is_completed}
        <li class="flex items-start gap-2 text-sm">
          <input type="checkbox" disabled checked={completed} class="mt-0.5" />
          <span
            class="min-w-0 break-words"
            class:line-through={completed}
            class:text-muted-foreground={completed}
          >
            {subtask.name}
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if payload.description}
  <section class="flex flex-col gap-2">
    <h2 class="text-base font-semibold leading-snug text-foreground">
      {$t('share.view.task.description_label')}
    </h2>
    <p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
      {payload.description}
    </p>
  </section>
{/if}
