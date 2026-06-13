import { listStore, taskStore, subtaskStore } from '@reborn/storage';
import { createLogger } from '@reborn/utils';

const logger = createLogger('LocalModeService');

/**
 * Re-stamp every local entity with the new account's user id and flag it pending
 * so a local-only (no-account) session can upgrade to a real account without
 * losing data. See planning/local-only-no-account-plan.md (decision B1).
 *
 * Why this is enough (and why it differs from reborn-notes' equivalent):
 *
 *  - **Ownership / visibility.** Task lists are queried locally by `user_id`
 *    (`listStore.query('user_id', ...)`), so the device-scoped UUID used while
 *    offline must be rewritten to the account id or the lists vanish under the
 *    new account. Tasks/subtasks are not queried by `user_id` locally (they hang
 *    off `task_list_id` / `task_id`), but we rewrite them too for consistency
 *    and clean push snapshots. The server assigns ownership from the JWT, so the
 *    body `user_id` is irrelevant to the server - this is purely for the local
 *    view; the next pull converges everything to the account id anyway.
 *
 *  - **Push.** Unlike Notes (whose push reads `sync_status === 'pending'` rows
 *    directly), Task uploads via the offline-operation queue. In local-only mode
 *    sync never runs, so that queue is a *complete, naturally-ordered* log of
 *    every create/update/delete (a list is always created before its tasks, so
 *    timestamps already order parent-before-child). The upgrade simply lets that
 *    queue replay - no re-enqueue needed, which also avoids the bulk-timestamp
 *    collision that re-enqueueing dozens of ops at once would risk.
 *
 *  - **Pull safety.** Flagging rows `pending` makes the post-upgrade pull skip
 *    them (`syncLists` skips `sync_status === 'pending'`), so a pull that races
 *    the push cannot clobber a not-yet-uploaded row.
 *
 * Idempotent and cheap: a no-op queue replay + a save per row. Failures bubble
 * up so the caller can fall back to the next periodic sync.
 */
export async function markAllLocalDataForUpload(newUserId: string): Promise<void> {
	const [lists, tasks, subtasks] = await Promise.all([
		listStore.getAll(),
		taskStore.getAll(),
		subtaskStore.getAll()
	]);

	const pending = 'pending' as const;
	const ops: Promise<unknown>[] = [];
	for (const l of lists) {
		ops.push(listStore.save({ ...l, user_id: newUserId, sync_status: pending }));
	}
	for (const t of tasks) {
		ops.push(taskStore.save({ ...t, user_id: newUserId, sync_status: pending }));
	}
	for (const s of subtasks) {
		ops.push(subtaskStore.save({ ...s, user_id: newUserId, sync_status: pending }));
	}

	await Promise.all(ops);
	logger.info(
		`Re-stamped ${lists.length} lists, ${tasks.length} tasks, ${subtasks.length} subtasks for account upload`,
		{ newUserId }
	);
}
