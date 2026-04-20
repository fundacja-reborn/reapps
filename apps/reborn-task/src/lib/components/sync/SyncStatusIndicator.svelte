<!--
	@component
	Compact sync status indicator for the app header.
	Shows current sync state (synced/syncing/offline/error/pending) with icon.
	Click triggers manual sync when online.
-->
<script lang="ts">
	import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@reborn/ui';
	import { toastStore } from '@reborn/ui';
	import { RefreshCw, Check, WifiOff, AlertCircle, CloudUpload, ShieldAlert } from '@lucide/svelte';
	import { syncStatus, type SyncStatusType } from '$lib/stores/sync-status.store';
	import { failedOperations } from '$lib/stores/offline-operations.store';
	import { offlineOperationsStore } from '$lib/stores/offline-operations.store';
	import { syncService } from '$lib/services/sync.service';
	import { t } from '$lib/stores/i18n.store';

	let isSyncing = $state(false);

	async function handleManualSync() {
		if (
			isSyncing ||
			$syncStatus.status === 'syncing' ||
			$syncStatus.status === 'offline' ||
			$syncStatus.status === 'auth-error'
		)
			return;

		// If there are failed operations and user clicks again, offer to clear them
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
			// First, try to sync again — maybe the errors are transient
			const result = await syncService.syncToServer();
			await syncService.initialSync();

			// Check if there are still failed operations after retry
			const stillFailed = $failedOperations.length;
			if (stillFailed > 0) {
				// Clean up only failed operations that can't be synced
				const count = stillFailed;
				for (const op of $failedOperations) {
					await offlineOperationsStore.removeOperation(op.id);
				}
				// Re-sync from server to get clean state
				await syncService.initialSync();
				toastStore.success($t('sync.cleanup_result', { values: { count } }));
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
				return 'text-amber-500';
			case 'auth-error':
				return 'text-destructive';
		}
	}

	function getTooltipText(status: SyncStatusType): string {
		switch (status) {
			case 'synced':
				return $t('sync.indicator.synced');
			case 'syncing':
				return $syncStatus.message || $t('sync.indicator.syncing');
			case 'offline':
				return $t('sync.indicator.offline');
			case 'error':
				return (
					$t('sync.indicator.error') +
					($syncStatus.failedCount > 0 ? ` (${$syncStatus.failedCount})` : '') +
					' — ' +
					$t('sync.indicator.tap_to_retry')
				);
			case 'pending':
				return $t('sync.indicator.pending', { values: { count: $syncStatus.pendingCount } });
			case 'auth-error':
				return $t('sync.indicator.session_expired');
		}
	}

	let Icon = $derived(getIcon($syncStatus.status));

	let isClickable = $derived(
		$syncStatus.status !== 'offline' &&
			$syncStatus.status !== 'syncing' &&
			$syncStatus.status !== 'auth-error' &&
			!isSyncing
	);
</script>

<TooltipProvider>
	<Tooltip>
		<TooltipTrigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					class="inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 {getColorClass(
						$syncStatus.status
					)}"
					onclick={handleManualSync}
					disabled={!isClickable}
					aria-label={getTooltipText($syncStatus.status)}
				>
					<Icon
						class="h-4 w-4 {$syncStatus.status === 'syncing' || isSyncing ? 'animate-spin' : ''}"
					/>
					{#if $syncStatus.status === 'pending' && $syncStatus.pendingCount > 0}
						<span
							class="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white"
						>
							{$syncStatus.pendingCount > 9 ? '9+' : $syncStatus.pendingCount}
						</span>
					{/if}
					{#if $syncStatus.status === 'error' && $syncStatus.failedCount > 0}
						<span
							class="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white"
						>
							{$syncStatus.failedCount > 9 ? '9+' : $syncStatus.failedCount}
						</span>
					{/if}
				</button>
			{/snippet}
		</TooltipTrigger>
		<TooltipContent>
			<p>{getTooltipText($syncStatus.status)}</p>
			{#if isClickable && $syncStatus.status !== 'synced'}
				<p class="text-xs text-muted-foreground">{$t('sync.indicator.tap_to_sync')}</p>
			{/if}
		</TooltipContent>
	</Tooltip>
</TooltipProvider>
