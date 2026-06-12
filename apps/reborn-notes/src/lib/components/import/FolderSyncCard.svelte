<script lang="ts">
  import { onMount } from 'svelte';
  import { LoadingSpinner, Progress } from '@reborn/ui';
  import { FolderSync, FolderOpen, RefreshCw, Unlink, AlertTriangle } from '@lucide/svelte';
  import { t, locale } from '$lib/stores/i18n.store';
  import {
    folderSyncStatus,
    isFolderSyncSupported,
    linkFolder,
    unlinkFolder,
    runFolderSync,
    setFolderAutoSync,
    refreshFolderSyncStatus
  } from '$lib/services/folder-sync.service';
  import type { ImportFolderResult } from '$lib/services/export-import.service';
  import ImportResultSummary from './ImportResultSummary.svelte';

  const supported = isFolderSyncSupported();

  // Result panel for the most recent run TRIGGERED FROM THIS CARD (initial
  // link import or "Sync now"). Background auto-runs only update the compact
  // last-result line - they must not pop UI the user didn't ask for.
  let runResult = $state<ImportFolderResult | null>(null);

  const status = $derived($folderSyncStatus);
  const busy = $derived(status.state === 'syncing');

  onMount(() => {
    if (supported) void refreshFolderSyncStatus();
  });

  async function handleLink() {
    runResult = null;
    runResult = await linkFolder();
  }

  async function handleSyncNow() {
    runResult = null;
    runResult = await runFolderSync('manual');
  }

  async function handleUnlink() {
    runResult = null;
    await unlinkFolder();
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

<div class="p-4 rounded-lg border bg-muted/30">
  <div class="flex flex-col sm:flex-row sm:items-center gap-3">
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <FolderSync class="h-4 w-4 shrink-0 text-muted-foreground" />
      <div>
        <p class="text-sm font-medium">
          {$t('settings_page.export_import.folder_sync_title')}
        </p>
        <p class="text-xs text-muted-foreground">
          {$t('settings_page.export_import.folder_sync_desc')}
        </p>
      </div>
    </div>
    {#if supported && status.state === 'unconfigured'}
      <button
        type="button"
        onclick={handleLink}
        disabled={busy}
        class="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
      >
        <FolderOpen class="h-3.5 w-3.5" />
        {$t('settings_page.export_import.folder_sync_pick_btn')}
      </button>
    {/if}
  </div>

  {#if !supported}
    <p class="mt-3 rounded-md border bg-background px-3 py-2.5 text-xs text-muted-foreground">
      {$t('settings_page.export_import.folder_sync_unsupported')}
    </p>
  {:else if status.state !== 'unconfigured'}
    <div class="mt-3 space-y-3 rounded-md border bg-background p-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0 text-xs">
          <p class="font-medium truncate">
            {$t('settings_page.export_import.folder_sync_linked', {
              values: { name: status.rootName ?? '' }
            })}
          </p>
          <p class="text-muted-foreground truncate">
            {$t('settings_page.export_import.folder_sync_destination', {
              values: { name: status.rootName ?? '' }
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
          <p class="text-[11px] text-muted-foreground/70">
            {$t('settings_page.export_import.folder_sync_no_full_path')}
          </p>
        </div>
        <div class="flex shrink-0 gap-2">
          <button
            type="button"
            onclick={handleSyncNow}
            disabled={busy}
            class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw class="h-3.5 w-3.5 {busy ? 'animate-spin' : ''}" />
            {busy
              ? $t('settings_page.export_import.folder_sync_syncing')
              : $t('settings_page.export_import.folder_sync_now_btn')}
          </button>
          <button
            type="button"
            onclick={handleUnlink}
            disabled={busy}
            class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Unlink class="h-3.5 w-3.5" />
            {$t('settings_page.export_import.folder_sync_unlink_btn')}
          </button>
        </div>
      </div>

      <label class="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={status.autoSync}
          disabled={busy}
          onchange={(e) => setFolderAutoSync((e.target as HTMLInputElement).checked)}
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

      <p class="text-xs text-muted-foreground">
        {$t('settings_page.export_import.folder_sync_safety_note')}
      </p>

      {#if status.state === 'needs-permission'}
        <div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
          <AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div class="text-xs text-amber-700 dark:text-amber-400">
            <p>{$t('settings_page.export_import.folder_sync_needs_permission')}</p>
            <button
              type="button"
              onclick={handleSyncNow}
              class="mt-1.5 rounded-md border border-amber-600/40 px-2.5 py-1 font-medium transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40"
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
          class="rounded-md border bg-muted/40 px-3 py-2.5 text-xs space-y-2"
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
  {/if}
</div>
