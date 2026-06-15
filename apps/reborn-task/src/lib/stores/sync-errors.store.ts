/**
 * Sync-error state for the task offline-operation queue.
 *
 * An operation the server permanently rejects (a 4xx the client can't fix by
 * retrying) is dead-lettered out of the queue and its target entity marked
 * `sync_status: 'sync_error'`. Because the poison op is removed, the signal
 * lives on the entity, not the queue - so this store rescans IndexedDB for such
 * entities and exposes the count + per-entity reason.
 *
 * Kept as a standalone leaf module (not in sync-status.store) so the sync engine
 * can import `refreshSyncErrors` without the sync.service <-> sync-status.store
 * import cycle (sync-status.store reads syncProgress from the service). Mirrors
 * the role of notes' refreshPendingCount(). See guideline 36, rule 14.
 */
import { writable, get } from 'svelte/store';
import { taskStore, listStore, subtaskStore } from '@reborn/storage';
import type { SyncErrorCode } from '@reborn/types';

// Count of entities permanently rejected by the server (sync_status: 'sync_error').
export const errorCount = writable(0);
// Per-entity rejection reason, keyed by entity id. Drives the per-task badge in
// the list without threading sync_status through the decrypted title index.
export const syncErrorMap = writable<Map<string, SyncErrorCode>>(new Map());

/** Content equality for the per-entity error map (sizes first, then entries). */
function sameErrorCodes(a: Map<string, SyncErrorCode>, b: Map<string, SyncErrorCode>): boolean {
	if (a.size !== b.size) return false;
	for (const [id, code] of a) {
		if (b.get(id) !== code) return false;
	}
	return true;
}

/**
 * Rescan IndexedDB for entities marked `sync_status: 'sync_error'` and publish
 * the count + per-entity reason map. Called after each sync (a push marks them,
 * a later successful push clears them). Cheap: three getAll() scans.
 *
 * Only tasks carry a `sync_error_code`; lists/subtasks (which realistically
 * never hit a permanent rejection) fall back to 'rejected' so the footer count
 * still reflects them.
 */
export async function refreshSyncErrors(): Promise<void> {
	try {
		const stores = [taskStore, listStore, subtaskStore] as Array<{
			getAll(): Promise<
				Array<{ id: string; sync_status?: string; sync_error_code?: SyncErrorCode }>
			>;
		}>;
		const all = await Promise.all(stores.map((s) => s.getAll()));
		const errors = new Map<string, SyncErrorCode>();
		for (const items of all) {
			for (const i of items) {
				if (i.sync_status === 'sync_error') errors.set(i.id, i.sync_error_code ?? 'rejected');
			}
		}
		errorCount.set(errors.size);
		// syncErrorMap is read by a $derived in every visible TaskItem. A writable
		// re-emits on every set (new ref !== old), so publishing it unconditionally
		// would recompute every row's badge on each sync even when nothing changed.
		// Publish only when the error set actually changed.
		if (!sameErrorCodes(get(syncErrorMap), errors)) syncErrorMap.set(errors);
	} catch {
		// Best-effort: a failed rescan just leaves the previous counts in place.
	}
}
