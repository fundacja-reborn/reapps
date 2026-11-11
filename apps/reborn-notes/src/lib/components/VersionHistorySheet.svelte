<script lang="ts">
  import { tick } from 'svelte';
  import { Clock, Loader2, Trash2 } from '@lucide/svelte';
  import type { NoteHistoryDecrypted } from '@reborn/types';
  import * as NoteService from '$lib/services/note.service';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, toastStore } from '@reborn/ui';
  import ConfirmDialog from '$lib/components/shared/ConfirmDialog.svelte';
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
  let listEl = $state<HTMLDivElement | null>(null);

  // Everything except versions[0], which is the current state (snapshotted when
  // the panel opened) and is never deleted from here.
  const olderCount = $derived(Math.max(versions.length - 1, 0));

  // One version: confirmed inline - the row turns into "are you sure" + buttons
  // (a light action, like the row's own trash button). All older versions: a
  // centered dialog - a bulk destructive action, and the confirm button must not
  // appear right under the finger that just tapped the footer (a quick double tap
  // on a phone would otherwise confirm it).
  let confirming = $state<string | null>(null);
  let clearDialogOpen = $state(false);
  // Count captured when the dialog opens: the list reloads before the dialog's
  // close animation ends, and a live count would flash "0" in its text.
  let clearDialogCount = $state(0);
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

  /**
   * Run a delete, then re-read the local list. A failed delete changed nothing
   * (note.service rolls back), so the list reload shows the same rows again.
   * Returns whether the delete went through.
   */
  async function runDelete(action: () => Promise<void>): Promise<boolean> {
    deleting = true;
    let ok = false;
    try {
      await action();
      ok = true;
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
    return ok;
  }

  // ── Focus ───────────────────────────────────────────────────────
  // Deleting removes the element that had focus (the row's confirm strip, or the
  // footer button that opened the dialog). Without a target, focus falls to
  // <body> and keyboard / screen-reader users lose their place in the panel.

  function rowSelectButtons(): HTMLButtonElement[] {
    return Array.from(listEl?.querySelectorAll<HTMLButtonElement>('[data-version-select]') ?? []);
  }

  /** Focus the version row at `index`, or the last one if the list got shorter. */
  function focusRow(index: number) {
    const rows = rowSelectButtons();
    rows[Math.min(index, rows.length - 1)]?.focus();
  }

  async function openRowConfirm(versionId: string) {
    confirming = versionId;
    await tick();
    // Safe default inside the strip: Cancel.
    listEl?.querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.focus();
  }

  async function cancelRowConfirm(versionId: string) {
    confirming = null;
    await tick();
    listEl?.querySelector<HTMLButtonElement>(`[data-version-trash="${versionId}"]`)?.focus();
  }

  async function deleteVersion(versionId: string) {
    const index = versions.findIndex((v) => v.id === versionId);
    const ok = await runDelete(() => NoteService.deleteNoteVersion(noteId, versionId));
    await tick();
    if (ok) {
      // The row below takes the deleted one's place (or the last row).
      focusRow(index);
    } else {
      listEl?.querySelector<HTMLButtonElement>(`[data-version-trash="${versionId}"]`)?.focus();
    }
  }

  async function clearOlderVersions() {
    const keep = versions[0]?.id;
    await runDelete(() => NoteService.clearNoteHistory(noteId, keep));
  }

  /**
   * Dialog closed. When the older versions are gone, the footer button that
   * opened it is gone too - move focus to the remaining "Current version" row
   * instead of letting it drop to <body>. On cancel (or a failed delete) the
   * button is still there and the dialog's default focus return is right.
   */
  function handleClearDialogCloseFocus(e: Event) {
    if (olderCount > 0) return;
    e.preventDefault();
    focusRow(0);
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

    <div class="flex-1 overflow-y-auto" bind:this={listEl}>
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
                      data-confirm-cancel
                      disabled={deleting}
                      onclick={() => cancelRowConfirm(entry.id)}
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
                    data-version-select
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
                      data-version-trash={entry.id}
                      class="flex w-11 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors
                        hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                      aria-label={$t('history.delete_version_label', {
                        values: { date: formatDate(entry.created_at) }
                      })}
                      title={$t('history.delete_version')}
                      disabled={deleting || confirming !== null}
                      onclick={() => openRowConfirm(entry.id)}
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

    <!-- Secondary action, deliberately quiet: the panel is for browsing and
         restoring. Muted at rest, destructive colour only on hover / keyboard
         focus. Only when there is something besides the current version; it
         disappears as soon as the last older version goes. Start-aligned with
         the version dates. Visually small, but 44px tall on touch screens. -->
    {#if !loading && olderCount > 0}
      <div class="shrink-0 border-t px-4 py-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))]">
        <Button
          variant="ghost"
          size="sm"
          class="-ms-2.5 h-11 text-muted-foreground hover:bg-destructive/10 hover:text-destructive
            focus-visible:text-destructive dark:hover:bg-destructive/15 md:h-8"
          aria-label={$t('history.delete_older_label', { values: { count: olderCount } })}
          disabled={deleting || confirming !== null}
          onclick={() => {
            clearDialogCount = olderCount;
            clearDialogOpen = true;
          }}
        >
          <Trash2 class="h-3.5 w-3.5" />
          {$t('history.delete_older', { values: { count: olderCount } })}
        </Button>
      </div>
    {/if}
  </SheetContent>
</Sheet>

<ConfirmDialog
  bind:open={clearDialogOpen}
  title={$t('history.delete_older_title')}
  description={$t('history.delete_older_desc', { values: { count: clearDialogCount } })}
  confirmText={$t('common.delete')}
  cancelText={$t('common.cancel')}
  destructive
  onConfirm={clearOlderVersions}
  onCloseAutoFocus={handleClearDialogCloseFocus}
/>
