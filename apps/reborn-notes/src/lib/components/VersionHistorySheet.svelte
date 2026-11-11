<script lang="ts">
  import { Clock, Loader2 } from '@lucide/svelte';
  import type { NoteHistoryDecrypted } from '@reborn/types';
  import * as NoteService from '$lib/services/note.service';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { dateFormat, timeFormat } from '$lib/stores/app-settings.store';
  import { formatNoteDate } from '$lib/utils/date-format';

  let {
    noteId,
    open,
    onselect,
    onclose
  }: {
    noteId: string;
    open: boolean;
    onselect: (version: NoteHistoryDecrypted, previousVersion: NoteHistoryDecrypted | null, isLatest: boolean) => void;
    onclose: () => void;
  } = $props();

  let versions = $state<NoteHistoryDecrypted[]>([]);
  let loading = $state(true);

  $effect(() => {
    if (open) {
      loadHistory(noteId);
    }
  });

  async function loadHistory(id: string) {
    loading = true;
    // Flush pending edits and snapshot current state before loading history.
    // saveVersionSnapshot has built-in deduplication — skips if content unchanged.
    await noteDetailService.flushPendingSave();
    await NoteService.saveVersionSnapshot(id);
    // Lazily pull server-side versions (best-effort, online-only). History is no
    // longer backfilled during sync; this is where other devices' snapshots land.
    // Offline or any failure degrades gracefully to the local history below.
    await NoteService.syncNoteVersionsFromServer(id);
    versions = await NoteService.getNoteHistoryDecrypted(id);
    loading = false;
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
              <button
                type="button"
                onclick={() =>
                  onselect(entry, index < versions.length - 1 ? versions[index + 1] : null, index === 0)}
                class="flex flex-col items-start gap-0.5 border-b px-4 py-3 text-start transition-colors
                  hover:bg-accent/50 active:bg-accent"
              >
                <span class="text-sm font-medium text-foreground"
                  >{formatDate(entry.created_at)}</span
                >
                {#if index === 0}
                  <span class="text-xs text-muted-foreground">{$t('history.current_version')}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </SheetContent>
</Sheet>
