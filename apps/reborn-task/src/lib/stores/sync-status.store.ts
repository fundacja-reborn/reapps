import { derived } from 'svelte/store';
import { isOnline } from './network.store';
import { syncProgress } from '$lib/services/sync.service';
import { pendingOperations, failedOperations } from './offline-operations.store';
import { sessionExpired } from './session-expired.store';

export type SyncStatusType = 'synced' | 'syncing' | 'offline' | 'error' | 'pending' | 'auth-error';

export interface SyncStatusState {
	status: SyncStatusType;
	pendingCount: number;
	failedCount: number;
	message: string;
	progress: number;
}

/**
 * Unified sync status derived from multiple stores.
 * Priority: auth-error > offline > syncing > error > pending > synced
 */
export const syncStatus = derived(
	[isOnline, syncProgress, pendingOperations, failedOperations, sessionExpired],
	([$isOnline, $syncProgress, $pendingOps, $failedOps, $sessionExpired]): SyncStatusState => {
		const pendingCount = $pendingOps.length;
		const failedCount = $failedOps.length;

		if ($sessionExpired && $isOnline) {
			return {
				status: 'auth-error',
				pendingCount,
				failedCount,
				message: '',
				progress: 0
			};
		}

		if (!$isOnline) {
			return {
				status: 'offline',
				pendingCount,
				failedCount,
				message: '',
				progress: 0
			};
		}

		if ($syncProgress.isInProgress) {
			return {
				status: 'syncing',
				pendingCount,
				failedCount,
				message: $syncProgress.message,
				progress: $syncProgress.progress
			};
		}

		if (failedCount > 0) {
			return {
				status: 'error',
				pendingCount,
				failedCount,
				message: '',
				progress: 0
			};
		}

		if (pendingCount > 0) {
			return {
				status: 'pending',
				pendingCount,
				failedCount,
				message: '',
				progress: 0
			};
		}

		return {
			status: 'synced',
			pendingCount: 0,
			failedCount: 0,
			message: '',
			progress: 0
		};
	}
);
