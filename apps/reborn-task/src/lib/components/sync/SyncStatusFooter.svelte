<!--
  @component
  Sync status footer for the task sidebar.
  Shows last sync state, click to trigger manual sync.
-->
<script lang="ts">
	import {
		RefreshCw,
		Check,
		WifiOff,
		AlertCircle,
		CloudUpload,
		ShieldAlert,
		HardDrive
	} from '@lucide/svelte';
	import { syncStatus, type SyncStatusType } from '$lib/stores/sync-status.store';
	import { syncService } from '$lib/services/sync.service';
	import { failedOperations, offlineOperationsStore } from '$lib/stores/offline-operations.store';
	import { t } from '$lib/stores/i18n.store';
	import { toastStore } from '@reborn/ui';

	let isSyncing = $state(false);

	async function handleSync() {
		if (
			isSyncing ||
			$syncStatus.status === 'syncing' ||
			$syncStatus.status === 'offline' ||
			$syncStatus.status === 'auth-error' ||
			$syncStatus.status === 'local_only'
		)
			return;

		if ($syncStatus.status === 'error' && $syncStatus.failedCount > 0) {
			await handleSyncWithCleanup();
			return;
		}

		isSyncing = true;
		try {
			const result = await syncService.syncToServer();
			await syncService.initialSync();
			if (result.failedCount > 0) {
				toastStore.error($t('sync.partial_failure', { values: { count: result.failedCount } }));
			}
		} catch {
			toastStore.error($t('sync.failed'));
		} finally {
			isSyncing = false;
		}
	}

	async function handleSyncWithCleanup() {
		isSyncing = true;
		try {
			await syncService.syncToServer();
			await syncService.initialSync();
			const stillFailed = $failedOperations.length;
			if (stillFailed > 0) {
				for (const op of $failedOperations) {
					await offlineOperationsStore.removeOperation(op.id);
				}
				await syncService.initialSync();
				toastStore.success($t('sync.cleanup_result', { values: { count: stillFailed } }));
			}
		} catch {
			toastStore.error($t('sync.failed'));
		} finally {
			isSyncing = false;
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
			case 'auth-error':
				return ShieldAlert;
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
			case 'auth-error':
				return 'text-destructive';
			case 'local_only':
				return 'text-muted-foreground';
		}
	}

	function getLabel(status: SyncStatusType): string {
		switch (status) {
			case 'synced':
				return $t('sync.indicator.synced');
			case 'syncing':
				return $syncStatus.message || $t('sync.indicator.syncing');
			case 'offline':
				return $t('sync.indicator.offline');
			case 'error':
				return $t('sync.indicator.error');
			case 'pending':
				return $t('sync.indicator.pending', { values: { count: $syncStatus.pendingCount } });
			case 'auth-error':
				return $t('sync.indicator.session_expired');
			case 'local_only':
				return $t('sync.indicator.local_only');
		}
	}

	let Icon = $derived(getIcon($syncStatus.status));
	let spinning = $derived($syncStatus.status === 'syncing' || isSyncing);
	let isClickable = $derived(
		$syncStatus.status !== 'offline' &&
			$syncStatus.status !== 'syncing' &&
			$syncStatus.status !== 'auth-error' &&
			$syncStatus.status !== 'local_only' &&
			!isSyncing
	);
</script>

<div
	class="border-t px-3 py-2"
	style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));"
>
	<button
		type="button"
		onclick={handleSync}
		disabled={!isClickable}
		class="flex items-center gap-1.5 min-w-0 w-full rounded-md px-1 py-1 md:py-0.5 text-sm md:text-xs transition-colors
           hover:bg-sidebar-accent disabled:pointer-events-none disabled:opacity-70
           {getColorClass($syncStatus.status)}"
		title={isClickable ? $t('sync.indicator.tap_to_sync') : getLabel($syncStatus.status)}
	>
		<Icon class="h-4 w-4 md:h-3.5 md:w-3.5 shrink-0 {spinning ? 'animate-spin' : ''}" />
		<span class="truncate">{getLabel($syncStatus.status)}</span>
	</button>
</div>
