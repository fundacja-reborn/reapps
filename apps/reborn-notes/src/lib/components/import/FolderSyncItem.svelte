<script lang="ts">
  import { LoadingSpinner, Progress } from '@reborn/ui';
  import { FolderSync, RefreshCw, Unlink, AlertTriangle, Pencil } from '@lucide/svelte';
  import { t, locale } from '$lib/stores/i18n.store';
  import {
    runFolderSync,
    unlinkFolder,
    setFolderAutoSync,
    updateFolderSyncConfig,
    type FolderSyncConfigStatus
  } from '$lib/services/folder-sync.service';
  import type { ImportFolderResult } from '$lib/services/export-import.service';
  import { foldersStore } from '$lib/stores/folders.store';
  import type { FolderWithChildren } from '@reborn/types';
  import ImportResultSummary from './ImportResultSummary.svelte';

  let {
    status,
    disabled = false
  }: {
    status: FolderSyncConfigStatus;
    /** True while ANY config is syncing - the runner is single-flight per tab. */
    disabled?: boolean;
  } = $props();

  // Result panel for the most recent run TRIGGERED FROM THIS ITEM ("Sync
  // now" / re-authorize). Background auto-runs only update the compact
  // last-result line - they must not pop UI the user didn't ask for.
  let runResult = $state<ImportFolderResult | null>(null);

  // Inline edit form (source label + destination folder name). Opened from
  // the Edit button; while open, the action buttons are locked so a rename
  // never races a sync that mutates the same record/folder.
  let editing = $state(false);
  let editSourceLabel = $state('');
  let editDestName = $state('');
  let editError = $state<'name-taken' | 'name-invalid' | 'name-cycle' | null>(null);
  let savingEdit = $state(false);

  const busy = $derived(status.state === 'syncing');
  const controlsDisabled = $derived(busy || disabled);
  const actionsDisabled = $derived(controlsDisabled || editing);
  // Source line text: the user's label, else the on-disk leaf name.
  const sourceText = $derived(status.sourceLabel ?? status.dirName);

  // Destination is linked by id, so prefer the LIVE folder breadcrumb (root →
  // leaf, reflecting a rename/move in the folder tree) and fall back to the
  // stored path. The folder can be nested, so this is a path, not a single name.
  function findFolderBreadcrumb(nodes: FolderWithChildren[], id: string): string[] | null {
    for (const n of nodes) {
      if (n.id === id) return [n.name];
      const sub = n.children ? findFolderBreadcrumb(n.children, id) : null;
      if (sub) return [n.name, ...sub];
    }
    return null;
  }
  // Ancestor names root → leaf. Live tree when resolved, else the stored
  // "/"-separated path (before the first sync resolves `targetFolderId`).
  const destSegments = $derived(
    (status.targetFolderId ? findFolderBreadcrumb($foldersStore, status.targetFolderId) : null) ??
      status.name.split('/').map((s) => s.trim()).filter(Boolean)
  );
  // Bold title = the leaf folder; the full path goes on the destination line.
  const leafName = $derived(destSegments[destSegments.length - 1] ?? status.name);
  // Breadcrumb for display ("Projekty › Docs") and the editable path ("Projekty/Docs").
  const destDisplay = $derived(destSegments.join(' › '));
  const destPathString = $derived(destSegments.join('/'));

  async function handleSyncNow() {
    runResult = null;
    runResult = await runFolderSync('manual', status.id);
  }

  async function handleUnlink() {
    runResult = null;
    await unlinkFolder(status.id);
  }

  function startEdit() {
    editSourceLabel = status.sourceLabel ?? '';
    editDestName = destPathString;
    editError = null;
    editing = true;
  }

  function cancelEdit() {
    editing = false;
    editError = null;
  }

  async function handleSaveEdit(e: Event) {
    e.preventDefault();
    // Never commit (especially a destination rename) while this config is
    // mid-sync - the import find-or-creates the target folder by name.
    if (savingEdit || busy || !editDestName.trim()) return;
    savingEdit = true;
    editError = null;
    try {
      const outcome = await updateFolderSyncConfig(status.id, {
        sourceLabel: editSourceLabel,
        destName: editDestName
      });
      if (!outcome.ok) {
        if (outcome.error === 'name-taken') editError = 'name-taken';
        else if (outcome.error === 'name-invalid') editError = 'name-invalid';
        else if (outcome.error === 'name-cycle') editError = 'name-cycle';
        return;
      }
      editing = false;
    } finally {
      savingEdit = false;
    }
  }

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString($locale ?? undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch {
      return iso;
    }
  }
</script>

<div class="space-y-3 rounded-lg border bg-muted/30 p-4">
  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex min-w-0 items-start gap-3">
      <FolderSync class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div class="min-w-0 text-xs">
        <p class="truncate text-sm font-medium">{leafName}</p>
        <p class="truncate text-muted-foreground">
          {$t('settings_page.export_import.folder_sync_source_dir', {
            values: { name: sourceText }
          })}
        </p>
        <p class="truncate text-muted-foreground">
          {$t('settings_page.export_import.folder_sync_destination', {
            values: { name: destDisplay }
          })}
        </p>
        {#if status.lastSyncAt}
          <p class="text-muted-foreground">
            {$t('settings_page.export_import.folder_sync_last_sync', {
              values: { time: formatTime(status.lastSyncAt) }
            })}
            {#if status.lastResult}
              · {$t('settings_page.export_import.folder_sync_last_result', {
                values: {
                  scanned: status.lastResult.scanned,
                  imported: status.lastResult.imported
                }
              })}
            {/if}
          </p>
        {/if}
      </div>
    </div>
    <div class="flex shrink-0 flex-wrap gap-2 sm:justify-end">
      <button
        type="button"
        onclick={handleSyncNow}
        disabled={actionsDisabled}
        class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
      >
        <RefreshCw class="h-3.5 w-3.5 {busy ? 'animate-spin' : ''}" />
        {busy
          ? $t('settings_page.export_import.folder_sync_syncing')
          : $t('settings_page.export_import.folder_sync_now_btn')}
      </button>
      <button
        type="button"
        onclick={startEdit}
        disabled={actionsDisabled}
        class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
      >
        <Pencil class="h-3.5 w-3.5" />
        {$t('settings_page.export_import.folder_sync_edit_btn')}
      </button>
      <button
        type="button"
        onclick={handleUnlink}
        disabled={actionsDisabled}
        class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
      >
        <Unlink class="h-3.5 w-3.5" />
        {$t('settings_page.export_import.folder_sync_unlink_btn')}
      </button>
    </div>
  </div>

  <label class="flex cursor-pointer items-start gap-2 text-xs">
    <input
      type="checkbox"
      checked={status.autoSync}
      disabled={actionsDisabled}
      onchange={(e) => setFolderAutoSync(status.id, (e.target as HTMLInputElement).checked)}
      class="mt-0.5"
    />
    <span>
      <span class="font-medium">
        {$t('settings_page.export_import.folder_sync_auto_label')}
      </span>
      <span class="block text-muted-foreground">
        {$t('settings_page.export_import.folder_sync_auto_desc')}
      </span>
    </span>
  </label>

  {#if editing}
    <form
      onsubmit={handleSaveEdit}
      class="space-y-3 rounded-md border border-primary/40 bg-background p-3"
    >
      <p class="text-xs font-medium">
        {$t('settings_page.export_import.folder_sync_edit_heading')}
      </p>
      <div class="space-y-1">
        <label class="text-xs font-medium" for="fs-src-{status.id}">
          {$t('settings_page.export_import.folder_sync_source_label_field')}
        </label>
        <input
          id="fs-src-{status.id}"
          type="text"
          bind:value={editSourceLabel}
          placeholder={status.dirName}
          maxlength="200"
          disabled={savingEdit}
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <p class="text-xs text-muted-foreground">
          {$t('settings_page.export_import.folder_sync_source_label_desc')}
        </p>
      </div>
      <div class="space-y-1">
        <label class="text-xs font-medium" for="fs-dst-{status.id}">
          {$t('settings_page.export_import.folder_sync_name_label')}
        </label>
        <input
          id="fs-dst-{status.id}"
          type="text"
          bind:value={editDestName}
          oninput={() => (editError = null)}
          maxlength="240"
          disabled={savingEdit}
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <p class="text-xs text-muted-foreground">
          {$t('settings_page.export_import.folder_sync_dest_edit_desc')}
        </p>
      </div>
      {#if editError === 'name-taken'}
        <p class="text-xs text-destructive">
          {$t('settings_page.export_import.folder_sync_name_taken')}
        </p>
      {:else if editError === 'name-invalid'}
        <p class="text-xs text-destructive">
          {$t('settings_page.export_import.folder_sync_name_invalid')}
        </p>
      {:else if editError === 'name-cycle'}
        <p class="text-xs text-destructive">
          {$t('settings_page.export_import.folder_sync_name_cycle')}
        </p>
      {/if}
      <div class="flex gap-2">
        <button
          type="submit"
          disabled={savingEdit || busy || !editDestName.trim()}
          class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {$t('settings_page.export_import.folder_sync_save_btn')}
        </button>
        <button
          type="button"
          onclick={cancelEdit}
          disabled={savingEdit}
          class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
        >
          {$t('settings_page.export_import.cancel')}
        </button>
      </div>
    </form>
  {/if}

  {#if status.state === 'needs-permission'}
    <div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
      <AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
      <div class="text-xs text-amber-700 dark:text-amber-400">
        <p>{$t('settings_page.export_import.folder_sync_needs_permission')}</p>
        <button
          type="button"
          onclick={handleSyncNow}
          disabled={controlsDisabled}
          class="mt-1.5 rounded-md border border-amber-600/40 px-2.5 py-1 font-medium transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
        >
          {$t('settings_page.export_import.folder_sync_reauthorize_btn')}
        </button>
      </div>
    </div>
  {/if}

  {#if status.state === 'error' && status.errorKey}
    <div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
      <AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
      <p class="text-xs text-amber-700 dark:text-amber-400">
        {status.errorKey === 'folder_gone'
          ? $t('settings_page.export_import.folder_sync_error_gone')
          : $t('settings_page.export_import.folder_sync_error_failed')}
      </p>
    </div>
  {/if}

  {#if busy}
    <div
      class="rounded-md border bg-background px-3 py-2.5 text-xs space-y-2"
      role="status"
      aria-live="polite"
    >
      <div class="flex items-center gap-2 text-muted-foreground">
        <LoadingSpinner size="sm" />
        <span>
          {#if status.progress?.phase === 'indexing'}
            {$t('settings_page.export_import.import_status_indexing')}
          {:else if status.progress && status.progress.total > 0}
            {$t('settings_page.export_import.import_status_reading', {
              values: { current: status.progress.current, total: status.progress.total }
            })}
          {:else}
            {$t('settings_page.export_import.folder_sync_scanning')}
          {/if}
        </span>
      </div>
      {#if status.progress?.phase === 'reading' && status.progress.total > 1}
        <Progress value={status.progress.current} max={status.progress.total} class="h-1.5" />
      {/if}
    </div>
  {/if}

  {#if runResult}
    <ImportResultSummary result={runResult} />
  {:else if !busy && status.lastResult && status.lastResult.scanned > 0 && status.lastResult.imported === 0 && status.lastResult.errors === 0 && status.state === 'idle'}
    <p class="text-xs text-muted-foreground">
      {$t('settings_page.export_import.folder_sync_up_to_date')}
    </p>
  {/if}
</div>
