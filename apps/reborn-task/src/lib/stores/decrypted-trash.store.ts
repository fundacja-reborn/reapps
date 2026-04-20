/**
 * Decrypted Trash Store
 *
 * This store provides reactive views of deleted task data for UI components.
 * It reads synchronously from the in-memory TaskIndex — NO decryption happens here.
 *
 * Data flow:
 * IndexedDB (encrypted) → TaskIndex (title-only decrypt, RAM cache) → THIS STORE → UI Components
 */

import { writable, derived, type Readable } from 'svelte/store';
import { taskIndex, type TaskListItem } from '$lib/services/task-title-index.svelte';

// ── Bridge: TaskIndex ($state) → Svelte stores (writable) ───────

const _trigger = writable(0);
taskIndex.onChange(() => _trigger.update((v) => v + 1));

/**
 * Reactive store with tasks in trash (soft-deleted).
 * Sorted by deletion date (newest first).
 */
export const decryptedTrashTasks: Readable<TaskListItem[]> = derived(_trigger, () => {
	const result = taskIndex.getFiltered({ deleted: true, excludeTemplates: false });
	return [...result.items].sort((a, b) => {
		if (!a.deleted_at && !b.deleted_at) return 0;
		if (!a.deleted_at) return 1;
		if (!b.deleted_at) return -1;
		return new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime();
	});
});

/**
 * Get the number of days since a task was deleted
 */
export function getDaysInTrash(deletedAt: string): number {
	const deletedDate = new Date(deletedAt);
	const now = new Date();
	const diffTime = Math.abs(now.getTime() - deletedDate.getTime());
	const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
	return diffDays;
}

/**
 * Check if a task should be automatically purged (>30 days in trash)
 */
export function shouldAutoPurge(deletedAt: string): boolean {
	return getDaysInTrash(deletedAt) > 30;
}
