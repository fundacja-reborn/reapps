import { derived } from 'svelte/store';
import { isOnline } from './network.store';
import { syncProgress, lastSyncedAt } from '$lib/services/sync.service';
import { pendingOperations, failedOperations } from './offline-operations.store';
import { sessionExpired } from './session-expired.store';
import { localOnly } from './local-mode.store';
import { errorCount } from './sync-errors.store';

export { lastSyncedAt };

export type SyncStatusType =
	| 'synced'
	| 'syncing'
	| 'offline'
	| 'error'
	// One or more entities were permanently rejected by the server (a 4xx the
	// client can't fix by retrying); their operation was dead-lettered out of the
	// queue. Distinct from transient 'error': this needs user action (e.g. fix an
	// invalid/oversized task).
	| 'sync_error'
	| 'pending'
	| 'auth-error'
	| 'local_only';

export interface SyncStatusState {
	status: SyncStatusType;
	pendingCount: number;
	failedCount: number;
	errorCount: number;
	message: string;
	progress: number;
	lastSyncedAt: string | null;
}

/**
 * Unified sync status derived from multiple stores.
 * Priority: local_only > auth-error > offline > syncing > sync_error > error > pending > synced
 */
export const syncStatus = derived(
	[
		isOnline,
		syncProgress,
		pendingOperations,
		failedOperations,
		errorCount,
		sessionExpired,
		lastSyncedAt,
		localOnly
	],
	([
		$isOnline,
		$syncProgress,
		$pendingOps,
		$failedOps,
		$errorCount,
		$sessionExpired,
		$lastSyncedAt,
		$localOnly
	]): SyncStatusState => {
		const pendingCount = $pendingOps.length;
		const failedCount = $failedOps.length;
		const base = {
			pendingCount,
			failedCount,
			errorCount: $errorCount,
			message: '',
			progress: 0,
			lastSyncedAt: $lastSyncedAt
		};

		if ($localOnly) {
			// No account, no server: sync never runs, so this overrides everything.
			return { ...base, status: 'local_only' };
		}

		if ($sessionExpired && $isOnline) {
			return { ...base, status: 'auth-error' };
		}

		if (!$isOnline) {
			return { ...base, status: 'offline' };
		}

		if ($syncProgress.isInProgress) {
			return {
				...base,
				status: 'syncing',
				message: $syncProgress.message,
				progress: $syncProgress.progress
			};
		}

		if ($errorCount > 0) {
			// Permanent rejections need user action (fix the invalid/oversized item),
			// so they outrank a transient sync error and the pending count.
			return { ...base, status: 'sync_error' };
		}

		if (failedCount > 0) {
			return { ...base, status: 'error' };
		}

		if (pendingCount > 0) {
			return { ...base, status: 'pending' };
		}

		return { ...base, status: 'synced', pendingCount: 0, failedCount: 0 };
	}
);

// True only during the very first sync after a fresh login (IndexedDB empty,
// `lastSyncedAt` not yet written). Used to swap empty-list placeholders for a
// reassuring loading state so users don't think their tasks were lost.
export const isInitialSync = derived(
	[syncProgress, lastSyncedAt],
	([$syncProgress, $lastSyncedAt]) => $syncProgress.isInProgress && $lastSyncedAt === null
);
