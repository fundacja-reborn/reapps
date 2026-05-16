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
  {@const headline = payload.display_name?.trim() || payload.title || $t('share.view.untitled')}
  <header class="flex flex-col gap-1">
    <h1 class="break-words text-xs leading-snug text-muted-foreground">
      {$t('share.view.note_label', { values: { label: headline } })}
    </h1>
    <div class="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {#if payload.shared_by_label}
        <span>{$t('share.view.shared_by', { values: { label: payload.shared_by_label } })}</span>
        <span aria-hidden="true">·</span>
      {/if}
      <span>{$t('share.view.shared_at', { values: { relative: formatRelative(payload.shared_at) } })}</span>
    </div>
  </header>
{/if}

<article class="prose prose-sm dark:prose-invert min-w-0 max-w-none">
  <!-- Force 'ask' regardless of the author's preference: the viewer (anonymous
       recipient) is the one whose IP leaks to image hosts, so the decision to
       fetch belongs to them, not the sender. Defense-in-depth per audit O34.
       `loadAllImagesHint` surfaces the *why* for non-technical viewers right
       next to the "Load all images" button. -->
  <MarkdownPreview
    content={payload.content}
    imageLoadMode="ask"
    loadAllImagesHint={$t('share.view.images_privacy_note')}
  />
</article>
