import { derived } from 'svelte/store';
import { isOnline } from './network.store';
import { syncProgress, lastSyncedAt } from '$lib/services/sync.service';
import { pendingOperations, failedOperations } from './offline-operations.store';
import { sessionExpired } from './session-expired.store';

export { lastSyncedAt };

export type SyncStatusType = 'synced' | 'syncing' | 'offline' | 'error' | 'pending' | 'auth-error';

export interface SyncStatusState {
	status: SyncStatusType;
	pendingCount: number;
	failedCount: number;
	message: string;
	progress: number;
	lastSyncedAt: string | null;
}

/**
 * Unified sync status derived from multiple stores.
 * Priority: auth-error > offline > syncing > error > pending > synced
 */
export const syncStatus = derived(
	[isOnline, syncProgress, pendingOperations, failedOperations, sessionExpired, lastSyncedAt],
	([
		$isOnline,
		$syncProgress,
		$pendingOps,
		$failedOps,
		$sessionExpired,
		$lastSyncedAt
	]): SyncStatusState => {
		const pendingCount = $pendingOps.length;
		const failedCount = $failedOps.length;

		if ($sessionExpired && $isOnline) {
			return {
				status: 'auth-error',
				pendingCount,
				failedCount,
				message: '',
				progress: 0,
				lastSyncedAt: $lastSyncedAt
			};
		}

		if (!$isOnline) {
			return {
				status: 'offline',
				pendingCount,
				failedCount,
				message: '',
				progress: 0,
				lastSyncedAt: $lastSyncedAt
			};
		}

		if ($syncProgress.isInProgress) {
			return {
				status: 'syncing',
				pendingCount,
				failedCount,
				message: $syncProgress.message,
				progress: $syncProgress.progress,
				lastSyncedAt: $lastSyncedAt
			};
		}

		if (failedCount > 0) {
			return {
				status: 'error',
				pendingCount,
				failedCount,
				message: '',
				progress: 0,
				lastSyncedAt: $lastSyncedAt
			};
		}

		if (pendingCount > 0) {
			return {
				status: 'pending',
				pendingCount,
				failedCount,
				message: '',
				progress: 0,
				lastSyncedAt: $lastSyncedAt
			};
		}

		return {
			status: 'synced',
			pendingCount: 0,
			failedCount: 0,
			message: '',
			progress: 0,
			lastSyncedAt: $lastSyncedAt
		};
	}
);

// True only during the very first sync after a fresh login (IndexedDB empty,
// `lastSyncedAt` not yet written). Used to swap empty-list placeholders for a
// reassuring loading state so users don't think their tasks were lost.
export const isInitialSync = derived(
	[syncProgress, lastSyncedAt],
	([$syncProgress, $lastSyncedAt]) => $syncProgress.isInProgress && $lastSyncedAt === null
);
