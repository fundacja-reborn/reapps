<script lang="ts">
  import { Clock, Loader2 } from '@lucide/svelte';
  import type { NoteHistoryDecrypted } from '@reborn/types';
  import * as NoteService from '$lib/services/note.service';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { dateFormat, timeFormat } from '$lib/stores/app-settings.store';

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
    versions = await NoteService.getNoteHistoryDecrypted(id);
    loading = false;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const fmt = $dateFormat;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    let datePart: string;
    switch (fmt) {
      case 'DD/MM/YYYY':
        datePart = `${day}/${month}/${year}`;
        break;
      case 'DD.MM.YYYY':
        datePart = `${day}.${month}.${year}`;
        break;
      case 'YYYY-MM-DD':
        datePart = `${year}-${month}-${day}`;
        break;
      case 'MM/DD/YYYY':
        datePart = `${month}/${day}/${year}`;
        break;
      default:
        datePart = `${day}/${month}/${year}`;
    }

    let timePart: string;
    if ($timeFormat === '12h') {
      const hours12 = d.getHours() % 12 || 12;
      const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
      timePart = `${hours12}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
    } else {
      timePart = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    return `${datePart}, ${timePart}`;
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      onclose();
    }
  }
</script>

<Sheet {open} onOpenChange={handleOpenChange}>
  <SheetContent side="right" class="w-80 sm:max-w-sm p-0 flex flex-col">
    <SheetHeader class="shrink-0 border-b px-4 py-3">
      <SheetTitle class="flex items-center gap-2 text-sm">
        <Clock class="h-4 w-4 text-muted-foreground" />
        {$t('history.title')}
      </SheetTitle>
    </SheetHeader>

    <div class="flex-1 overflow-y-auto">
      {#if loading}
        <div class="flex flex-1 items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
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
                class="flex flex-col items-start gap-0.5 border-b px-4 py-3 text-left transition-colors
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
