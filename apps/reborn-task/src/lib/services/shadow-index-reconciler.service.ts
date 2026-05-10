import { taskStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import type { TaskEncryptedBooleans, TaskSensitiveMetadata } from '@reborn/types';

const logger = createLogger('ShadowIndexReconciler');

/**
 * Result of a reconciliation pass — exposed for telemetry / tests.
 */
export interface ReconcileResult {
	/** Tasks scanned in IDB. */
	scanned: number;
	/** Tasks whose shadow indexes were corrected (had drifted from metadata bundle). */
	repaired: number;
	/** Tasks whose `metadata_encrypted` could not be decrypted — left unchanged. */
	skipped: number;
	/** Tasks with no `metadata_encrypted` payload (legacy backward-compat). */
	skippedNoMetadata: number;
}

/**
 * Compare two shadow-index field sets — true if they differ enough to need a save.
 * Compares `is_completed`, `is_starred`, `is_recurring`, `due_date` — the four
 * fields the UI reads directly from IDB without re-deriving from metadata.
 */
function shadowIndexesDiffer(
	current: TaskEncryptedBooleans,
	rebuilt: TaskEncryptedBooleans
): boolean {
	return (
		current.is_completed !== rebuilt.is_completed ||
		current.is_starred !== rebuilt.is_starred ||
		(current.is_recurring ?? false) !== (rebuilt.is_recurring ?? false) ||
		(current.due_date ?? null) !== (rebuilt.due_date ?? null)
	);
}

/**
 * Iterate all tasks in IDB, decrypt each `metadata_encrypted` bundle, and
 * overwrite local shadow indexes when they drift from the bundle's truth.
 *
 * This is the recovery half of the 2026-05-10 fix. Phase 1 hardens the
 * write path so new corruptions cannot happen; this reconciler heals
 * already-corrupted IDB rows that no future server pull will fix on its
 * own (server `sync_version` ≤ local → pull is a no-op).
 *
 * Tasks whose metadata cannot be decrypted (wrong key, corrupted ciphertext)
 * are deliberately left unchanged — overwriting them with defaults would be
 * exactly the bug we are fixing.
 *
 * Caller MUST ensure `cryptoManager.isInitialized() === true` before invoking,
 * otherwise this is a no-op (every decrypt would fail).
 */
export async function verifyAndRebuildLocalShadowIndexes(): Promise<ReconcileResult> {
	const result: ReconcileResult = {
		scanned: 0,
		repaired: 0,
		skipped: 0,
		skippedNoMetadata: 0
	};

	if (!cryptoManager.isInitialized()) {
		logger.debug('Reconciler skipped — crypto not initialized');
		return result;
	}

	let tasks: TaskEncryptedBooleans[];
	try {
		tasks = await taskStore.getAll();
	} catch (error: unknown) {
		logger.error('Reconciler failed to read tasks from IDB:', error);
		return result;
	}

	for (const task of tasks) {
		result.scanned++;

		if (!task.metadata_encrypted) {
			result.skippedNoMetadata++;
			continue;
		}

		let meta: TaskSensitiveMetadata;
		try {
			meta = await cryptoManager.decryptObject<TaskSensitiveMetadata>(task.metadata_encrypted);
		} catch (error: unknown) {
			result.skipped++;
			logger.debug(
				`Reconciler skipped task ${task.id} — metadata decrypt failed (likely key mismatch)`,
				error
			);
			continue;
		}

		const rebuilt: TaskEncryptedBooleans = {
			...task,
			is_completed: meta.is_completed ?? false,
			is_starred: meta.is_starred ?? false,
			is_recurring: meta.is_recurring,
			due_date: meta.due_date ?? null
		};

		if (!shadowIndexesDiffer(task, rebuilt)) continue;

		try {
			await taskStore.save(rebuilt);
			result.repaired++;
		} catch (error: unknown) {
			logger.warn(`Reconciler failed to save repaired task ${task.id}:`, error);
		}
	}

	if (result.repaired > 0 || result.skipped > 0) {
		logger.info(
			`Reconciled shadow indexes: scanned=${result.scanned} repaired=${result.repaired} ` +
				`skipped(decrypt-failed)=${result.skipped} skipped(no-metadata)=${result.skippedNoMetadata}`
		);
	} else {
		logger.debug(
			`Reconciler no-op: scanned=${result.scanned} skipped(no-metadata)=${result.skippedNoMetadata}`
		);
	}

	return result;
}

// Exported for tests
export const __testing = { shadowIndexesDiffer };
