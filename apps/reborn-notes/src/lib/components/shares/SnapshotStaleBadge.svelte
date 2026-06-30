<script lang="ts">
  import { FileClock } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { notesStore } from '$lib/stores/notes.store';

  // The "note changed since shared" hint as a compact inline micro-label, for
  // surfaces that list several shares at once (where a per-row $effect can't live
  // in the parent's {#each}). Mirrors the share detail panel's staleness check:
  // load the live note by the id baked into the snapshot payload only to read its
  // updated_at, and compare it to when the snapshot was frozen. Reads IndexedDB
  // (already-decrypted plaintext) - no server call, fully ZK-safe. A trashed
  // (is_archived) or absent note yields no badge, same gate as the panel.
  let {
    sourceId,
    sharedAt
  }: {
    sourceId: string | null | undefined;
    sharedAt: string | null | undefined;
  } = $props();

  let sourceUpdatedAt = $state<string | null>(null);
  $effect(() => {
    const sid = sourceId;
    sourceUpdatedAt = null;
    if (!sid) return;
    let cancelled = false;
    void notesStore.loadNote(sid).then((n) => {
      if (cancelled) return;
      sourceUpdatedAt = n && !n.is_archived ? n.updated_at : null;
    });
    return () => {
      cancelled = true;
    };
  });

  // updated_at also moves on non-content edits (pin / move), so this is an
  // informational hint, not proof the shared text changed.
  const stale = $derived(
    !!(
      sourceUpdatedAt
      && sharedAt
      && new Date(sourceUpdatedAt).getTime() > new Date(sharedAt).getTime()
    )
  );
</script>

{#if stale}
  <span
    class="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400"
  >
    <FileClock class="h-3 w-3" aria-hidden="true" />
    {$t('share.list.snapshot_stale')}
  </span>
{/if}
