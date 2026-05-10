import { cryptoManager } from '@reborn/crypto';
import type {
	TaskEncrypted,
	TaskEncryptedBooleans,
	TaskSensitiveMetadata
} from '@reborn/types';

/**
 * Backward-compat shadow indexes for tasks that legitimately have no
 * `metadata_encrypted` bundle (created before the bundle was introduced).
 * Used only as a deliberate fallback — never as a silent rescue from a
 * failed decrypt, which is what corrupted IDB on 2026-05-10.
 */
export function defaultShadowIndexes(task: TaskEncrypted): TaskEncryptedBooleans {
	return {
		...task,
		is_completed: false,
		is_starred: false,
		is_template: task.is_template === 1,
		due_date: null
	} as TaskEncryptedBooleans;
}

/**
 * Rebuild local shadow indexes from encrypted metadata.
 * Decrypts metadata_encrypted → TaskSensitiveMetadata → shadow fields.
 *
 * Throws when crypto is not ready or decryption fails — caller MUST skip
 * the IDB save in that case. Silently writing default shadow indexes here
 * caused the 2026-05-10 incident where unlock'd PWA Task showed every task
 * with `is_completed=false / due_date=null` until a full logout+login.
 *
 * The only branch that legitimately falls back to defaults is a task
 * without any `metadata_encrypted` payload — backward compat for tasks
 * created before the metadata bundle existed.
 */
export async function rebuildShadowIndexes(
	task: TaskEncrypted
): Promise<TaskEncryptedBooleans> {
	if (!task.metadata_encrypted) {
		return defaultShadowIndexes(task);
	}

	if (!cryptoManager.isInitialized()) {
		throw new Error(
			`crypto-not-ready: master key unavailable while rebuilding shadow indexes for task ${task.id}`
		);
	}

	try {
		const meta = await cryptoManager.decryptObject<TaskSensitiveMetadata>(
			task.metadata_encrypted
		);
		return {
			...task,
			is_completed: meta.is_completed ?? false,
			is_starred: meta.is_starred ?? false,
			is_recurring: meta.is_recurring,
			is_template: task.is_template === 1,
			due_date: meta.due_date ?? null
		} as TaskEncryptedBooleans;
	} catch (error: unknown) {
		const cause = error instanceof Error ? error.message : String(error);
		throw new Error(
			`decrypt-failed: metadata decryption failed for task ${task.id} (${cause})`,
			{ cause: error }
		);
	}
}
