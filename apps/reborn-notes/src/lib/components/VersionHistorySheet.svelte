<script lang="ts">
  import { Clock, Loader2, Trash2 } from '@lucide/svelte';
  import type { NoteHistoryDecrypted } from '@reborn/types';
  import * as NoteService from '$lib/services/note.service';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, toastStore } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { dateFormat, timeFormat } from '$lib/stores/app-settings.store';
  import { formatNoteDate } from '$lib/utils/date-format';

  let {
    noteId,
    open,
    onselect,
    onclose,
    ondeleted
  }: {
    noteId: string;
    open: boolean;
    onselect: (version: NoteHistoryDecrypted, previousVersion: NoteHistoryDecrypted | null, isLatest: boolean) => void;
    onclose: () => void;
    /** Versions were deleted - a version picked earlier may be gone or have a new neighbour. */
    ondeleted?: () => void;
  } = $props();

  let versions = $state<NoteHistoryDecrypted[]>([]);
  let loading = $state(true);

  // Confirmation happens inside the sheet (the row, or the footer, turns into
  // "are you sure" + buttons) rather than in a dialog stacked on the open sheet.
  // One confirmation at a time: a version id, 'all' for "Clear history", or null.
  let confirming = $state<string | 'all' | null>(null);
  let deleting = $state(false);

  $effect(() => {
    if (open) {
      loadHistory(noteId);
    } else {
      confirming = null;
    }
  });

  async function loadHistory(id: string) {
    loading = true;
    // Flush pending edits and snapshot current state before loading history.
    // saveVersionSnapshot has built-in deduplication - skips if content unchanged.
    await noteDetailService.flushPendingSave();
    await NoteService.saveVersionSnapshot(id);
    // Lazily pull server-side versions (best-effort, online-only). History is no
    // longer backfilled during sync; this is where other devices' snapshots land,
    // and where versions deleted on another device leave this one (#521).
    // Offline or any failure degrades gracefully to the local history below.
    await NoteService.syncNoteVersionsFromServer(id);
    versions = await NoteService.getNoteHistoryDecrypted(id);
    loading = false;
  }

  /** Run a delete, then re-read the local list. A failed delete changed nothing. */
  async function runDelete(action: () => Promise<void>) {
    deleting = true;
    try {
      await action();
      ondeleted?.();
    } catch (err) {
      toastStore.error(
        err instanceof NoteService.HistoryDeleteOfflineError
          ? $t('history.delete_offline')
          : $t('history.delete_failed')
      );
    } finally {
      confirming = null;
      deleting = false;
      versions = await NoteService.getNoteHistoryDecrypted(noteId);
    }
  }

  function deleteVersion(versionId: string) {
    void runDelete(() => NoteService.deleteNoteVersion(noteId, versionId));
  }

  function clearHistory() {
    // versions[0] is the current state (snapshotted when the panel opened) - keep it.
    const keep = versions[0]?.id;
    void runDelete(() => NoteService.clearNoteHistory(noteId, keep));
  }

  function formatDate(iso: string): string {
    return formatNoteDate(iso, $dateFormat, $timeFormat);
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      onclose();
    }
  }
</script>

<Sheet {open} onOpenChange={handleOpenChange}>
  <SheetContent side="right" overlayClass="bg-black/20" class="w-80 sm:max-w-sm p-0 flex flex-col">
    <SheetHeader class="shrink-0 border-b px-4 py-3">
      <SheetTitle class="flex items-center gap-2 text-sm">
        <Clock class="h-4 w-4 text-muted-foreground" />
        {$t('history.title')}
      </SheetTitle>
    </SheetHeader>

    <div class="flex-1 overflow-y-auto">
      {#if loading}
        <div class="flex flex-1 items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 class="me-2 h-4 w-4 animate-spin" />
          {$t('history.loading')}
        </div>
      {:else}
        {#if versions.length === 0}
          <div
            class="flex flex-1 items-center justify-center px-4 py-12 text-center text-sm text-muted-foreground"
          >
            {$t('history.no_history')}
          </div>
        {:else}
          <div class="flex flex-col">
            {#each versions as entry, index (entry.id)}
              {#if confirming === entry.id}
                <!-- Inline confirmation for this one version. -->
                <div class="flex flex-col gap-2 border-b bg-destructive/5 px-4 py-3">
                  <span class="text-sm font-medium text-foreground">{formatDate(entry.created_at)}</span>
                  <p class="text-xs text-muted-foreground">{$t('history.delete_version_desc')}</p>
                  <div class="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={deleting}
                      onclick={() => (confirming = null)}
                    >
                      {$t('common.cancel')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleting}
                      onclick={() => deleteVersion(entry.id)}
                    >
                      {#if deleting}
                        <Loader2 class="h-3.5 w-3.5 animate-spin" />
                      {/if}
                      {$t('history.delete_version')}
                    </Button>
                  </div>
                </div>
              {:else}
                <div class="flex items-stretch border-b">
                  <button
                    type="button"
                    onclick={() =>
                      onselect(entry, index < versions.length - 1 ? versions[index + 1] : null, index === 0)}
                    class="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-4 py-3 text-start transition-colors
                      hover:bg-accent/50 active:bg-accent"
                  >
                    <span class="text-sm font-medium text-foreground"
                      >{formatDate(entry.created_at)}</span
                    >
                    {#if index === 0}
                      <span class="text-xs text-muted-foreground">{$t('history.current_version')}</span>
                    {/if}
                  </button>
                  <!-- The current version is the note itself: nothing to delete (like
                       "Restore", which is disabled for it too). Always visible, not
                       hover-only, so it works on touch. -->
                  {#if index > 0}
                    <button
                      type="button"
                      class="flex w-11 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors
                        hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                      aria-label={$t('history.delete_version_label', {
                        values: { date: formatDate(entry.created_at) }
                      })}
                      title={$t('history.delete_version')}
                      disabled={deleting || confirming !== null}
                      onclick={() => (confirming = entry.id)}
                    >
                      <Trash2 class="h-4 w-4" />
                    </button>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <!-- "Clear history": only when there is something besides the current version. -->
    {#if !loading && versions.length > 1}
      <div class="shrink-0 border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        {#if confirming === 'all'}
          <p class="mb-2 text-sm font-medium text-foreground">{$t('history.clear_title')}</p>
          <p class="mb-3 text-xs text-muted-foreground">{$t('history.clear_desc')}</p>
          <div class="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={deleting} onclick={() => (confirming = null)}>
              {$t('common.cancel')}
            </Button>
            <Button variant="destructive" size="sm" disabled={deleting} onclick={clearHistory}>
              {#if deleting}
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
              {/if}
              {$t('history.clear')}
            </Button>
          </div>
        {:else}
          <Button
            variant="outline"
            size="sm"
            class="w-full text-destructive hover:text-destructive"
            disabled={deleting || confirming !== null}
            onclick={() => (confirming = 'all')}
          >
            <Trash2 class="h-3.5 w-3.5" />
            {$t('history.clear')}
          </Button>
        {/if}
      </div>
    {/if}
  </SheetContent>
</Sheet>
