<!--
  @component
  Sync status footer for the sidebar second column.
  Shows last sync time, pending changes count, and manual sync button.
  When session is expired, replaces normal content with a re-login prompt.
-->
<script lang="ts">
  import {
    RefreshCw,
    Check,
    WifiOff,
    AlertCircle,
    CloudUpload,
    AlertTriangle,
    HardDrive
  } from '@lucide/svelte';
  import { syncStatus, type SyncStatusType } from '$lib/stores/sync-status.store';
  import { pullFromServer, pushPendingItems, refreshStoresAfterPull } from '$lib/services/notes-sync.service';
  import { t } from '$lib/stores/i18n.store';

  let manualSyncing = $state(false);

  async function handleSync() {
    if (
      manualSyncing ||
      $syncStatus.status === 'syncing' ||
      $syncStatus.status === 'offline' ||
      $syncStatus.status === 'local_only'
    )
      return;

    manualSyncing = true;
    try {
      await pushPendingItems();
      const synced = await pullFromServer();
      if (synced) {
        await refreshStoresAfterPull();
      }
    } finally {
      manualSyncing = false;
    }
  }

  function getIcon(status: SyncStatusType) {
    switch (status) {
      case 'synced':
        return Check;
      case 'syncing':
        return RefreshCw;
      case 'offline':
        return WifiOff;
      case 'error':
        return AlertCircle;
      case 'pending':
        return CloudUpload;
      case 'needs_sync':
        return RefreshCw;
      case 'session_expired':
        return AlertTriangle;
      case 'local_only':
        return HardDrive;
    }
  }

  function getColorClass(status: SyncStatusType): string {
    switch (status) {
      case 'synced':
        return 'text-muted-foreground';
      case 'syncing':
        return 'text-primary';
      case 'offline':
        return 'text-muted-foreground';
      case 'error':
        return 'text-destructive';
      case 'pending':
        return 'text-amber-500 dark:text-amber-400';
      case 'needs_sync':
        return 'text-amber-500 dark:text-amber-400';
      case 'session_expired':
        return 'text-destructive';
      case 'local_only':
        return 'text-muted-foreground';
    }
  }

  function getLabel(status: SyncStatusType): string {
    switch (status) {
      case 'synced':
        return $t('sync_status.synced');
      case 'syncing':
        return $t('sync_status.syncing');
      case 'offline':
        return $t('sync_status.offline');
      case 'error':
        return $t('sync_status.error');
      case 'pending':
        return $t('sync_status.pending', { values: { count: $syncStatus.pendingCount } });
      case 'needs_sync':
        return $t('sync_status.not_synced');
      case 'session_expired':
        return $t('sync_status.session_expired');
      case 'local_only':
        return $t('sync_status.local_only');
    }
  }

  function formatTime(iso: string | null): string | null {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return null;
    }
  }

  let Icon = $derived(getIcon($syncStatus.status));
  let spinning = $derived($syncStatus.status === 'syncing' || manualSyncing);
  let isClickable = $derived(
    $syncStatus.status !== 'offline' &&
      $syncStatus.status !== 'syncing' &&
      $syncStatus.status !== 'session_expired' &&
      $syncStatus.status !== 'local_only' &&
      !manualSyncing
  );
  let isSessionExpired = $derived($syncStatus.status === 'session_expired');
  let timeStr = $derived(formatTime($syncStatus.lastSyncedAt));
</script>

<div
  class="border-t px-3 py-2"
  style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));"
>
  {#if isSessionExpired}
    <div
      class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-left
             text-destructive"
    >
      <AlertTriangle class="h-4 w-4 md:h-3.5 md:w-3.5 shrink-0 mt-0.5" />
      <span>{$t('sync_status.session_expired')}</span>
    </div>
  {:else}
    <button
      type="button"
      onclick={handleSync}
      disabled={!isClickable}
      class="flex items-center gap-1.5 min-w-0 w-full rounded-md px-1 py-1 md:py-0.5 text-sm md:text-xs transition-colors
             hover:bg-sidebar-accent disabled:pointer-events-none disabled:opacity-70
             {getColorClass($syncStatus.status)}"
      title={isClickable ? $t('sync_status.click_to_sync') : getLabel($syncStatus.status)}
    >
      <Icon class="h-4 w-4 md:h-3.5 md:w-3.5 shrink-0 {spinning ? 'animate-spin' : ''}" />
      <span class="truncate">{getLabel($syncStatus.status)}</span>
      {#if timeStr && $syncStatus.status === 'synced'}
        <span class="ml-auto shrink-0 text-[10px] text-muted-foreground/60">{timeStr}</span>
      {/if}
    </button>
  {/if}
</div>
