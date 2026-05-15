<script lang="ts">
  import { t } from '$lib/stores/i18n.store';
  import MarkdownPreview from '$lib/components/MarkdownPreview.svelte';
  import type { SharedSnapshotNotePayload } from '@reborn/types';

  let { payload, showHeader = true }: { payload: SharedSnapshotNotePayload; showHeader?: boolean } = $props();

  function formatRelative(iso: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
</script>

{#if showHeader}
  <h1 class="break-words text-2xl font-semibold leading-tight">
    {payload.title || $t('share.view.untitled')}
  </h1>

  <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
    {#if payload.shared_by_label}
      <span>{$t('share.view.shared_by', { values: { label: payload.shared_by_label } })}</span>
    {/if}
    <span>{$t('share.view.shared_at', { values: { relative: formatRelative(payload.shared_at) } })}</span>
  </div>
{/if}

<article class="prose prose-sm dark:prose-invert min-w-0 max-w-none">
  <MarkdownPreview content={payload.content} imageLoadMode={payload.metadata?.image_mode ?? 'ask'} />
</article>
