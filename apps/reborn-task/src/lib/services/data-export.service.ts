import { taskStore, listStore, subtaskStore } from '@reborn/storage';
import {
	cryptoManager,
	encryptWithPassword
} from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import type {
	ListDecrypted,
	ListEncrypted,
	TaskDecrypted,
	TaskEncrypted,
	TaskEncryptedBooleans,
	TaskSensitiveMetadata,
	Subtask,
	SubtaskSensitiveMetadata,
	SubtaskEncrypted,
	SubtaskStoredLocal
} from '@reborn/types';

const logger = createLogger('DataExportService');

/**
 * Drop the listed fields if their value is exactly `null`, returning a new
 * object. Used at export time so optional-but-not-nullable fields don't leak
 * `null` into the backup file (where they'd persist through `JSON.stringify`
 * and trip strict Zod schemas on a future import).
 */
function stripNullOptionalFields(
	raw: Record<string, unknown>,
	fields: readonly string[]
): Record<string, unknown> {
	const out = { ...raw };
	for (const field of fields) {
		if (out[field] === null) delete out[field];
	}
	return out;
}

/**
 * Encrypted export format version.
 *
 * - 1.0 (legacy): emitted local-only shadow indexes (is_completed, is_starred,
 *                 is_recurring, due_date, subtask is_completed) in plaintext —
 *                 a Zero Knowledge violation.
 * - 1.1 (current): strips ALL shadow indexes; they are rebuilt from
 *                  metadata_encrypted on import.
 */
const ENCRYPTED_EXPORT_VERSION = '1.1';
const DECRYPTED_EXPORT_VERSION = '1.0';
/** Envelope format version for the portable, password-encrypted backup. */
const PORTABLE_EXPORT_VERSION = '1.0';

export interface ExportDataDecrypted {
	version: string;
	app: string;
	exportedAt: string;
	encrypted: false;
	data: {
		lists: ListDecrypted[];
		tasks: TaskDecrypted[];
		subtasks: Subtask[];
	};
}

export interface ExportDataEncrypted {
	version: string;
	app: string;
	exportedAt: string;
	encrypted: true;
	data: {
		lists: ListEncrypted[];
		tasks: TaskEncrypted[];
		subtasks: SubtaskEncrypted[];
	};
}

export type ExportData = ExportDataDecrypted | ExportDataEncrypted;

/**
 * Portable, password-encrypted backup envelope.
 *
 * Wraps a DECRYPTED {@link ExportDataDecrypted} payload in a PBKDF2 + AES-GCM
 * layer keyed by a user-chosen password. Because the inner data is plaintext
 * (not account-key ciphertext), it can be imported on ANY account - the
 * importer re-encrypts it with the target account's master key. The account-key
 * `exportEncrypted` backup, by contrast, is readable only on the originating
 * account.
 *
 * Zero Knowledge: decrypt (export) and re-encrypt (import) both happen in the
 * browser; only the password-encrypted envelope ever leaves the device.
 */
export interface PortableEncryptedExport {
	app: 'reborn-task';
	version: string;
	exportedAt: string;
	/** Discriminator: marks this as a portable envelope vs a plain ExportData file. */
	portable: true;
	encryption: 'aes-256-gcm-pbkdf2';
	salt: string;
	iv: string;
	/** base64 AES-GCM ciphertext of the JSON-encoded ExportDataDecrypted payload. */
	data: string;
}

export class DataExportService {
	/**
	 * Decrypt all lists/tasks/subtasks with the current account key into a
	 * plaintext {@link ExportDataDecrypted} payload. Shared by the decrypted
	 * export and the portable (password-encrypted) export below.
	 */
	private async buildDecryptedPayload(): Promise<ExportDataDecrypted> {
		if (!cryptoManager.isInitialized()) {
			throw new Error('CryptoManager nie jest zainicjalizowany');
		}

		logger.info('Decrypting all data for export...');

		const [allLists, allTasks, allSubtasks] = await Promise.all([
			listStore.getAll(),
			taskStore.getAll(),
			subtaskStore.getAll()
		]);

		// Decrypt lists
		const decryptedLists: ListDecrypted[] = await Promise.all(
			allLists
				.filter((l) => !l.deleted_at)
				.map(async (list) => {
					const name = await cryptoManager.decryptText(list.name_encrypted);
					let color: string | undefined;
					let icon: string | undefined;
					if (list.metadata_encrypted) {
						try {
							const meta = await cryptoManager.decryptObject<{ color?: string; icon?: string }>(
								list.metadata_encrypted
							);
							color = meta.color;
							icon = meta.icon;
						} catch {
							// ignore
						}
					}
					return {
						id: list.id,
						name,
						color,
						icon,
						order_index: list.order_index,
						is_default: list.is_default,
						created_at: list.created_at,
						updated_at: list.updated_at,
						deleted_at: list.deleted_at ?? undefined
					};
				})
		);

		// Decrypt tasks
		const decryptedTasks: TaskDecrypted[] = await Promise.all(
			allTasks
				.filter((t) => !t.deleted_at)
				.map(async (task) => {
					const title = await cryptoManager.decryptText(task.title_encrypted);
					const description = task.description_encrypted
						? await cryptoManager.decryptText(task.description_encrypted)
						: undefined;
					const recurrence_rule = task.recurrence_rule_encrypted
						? await cryptoManager.decryptText(task.recurrence_rule_encrypted)
						: undefined;

					// Decrypt metadata for sensitive fields
					let meta: Partial<TaskSensitiveMetadata> = {};
					if (task.metadata_encrypted) {
						try {
							meta = await cryptoManager.decryptObject<TaskSensitiveMetadata>(
								task.metadata_encrypted
							);
						} catch {
							// Fallback to shadow indexes
						}
					}

					return {
						id: task.id,
						task_list_id: task.task_list_id,
						title,
						description,
						due_date: meta.due_date ?? task.due_date ?? undefined,
						has_time: meta.has_time,
						is_completed: meta.is_completed ?? task.is_completed,
						is_starred: meta.is_starred ?? task.is_starred,
						is_recurring: meta.is_recurring ?? task.is_recurring ?? false,
						recurrence_rule,
						// Normalize null → undefined so it drops from the JSON file.
						// Strict importers (TaskDecryptedSchema before relaxation) reject null.
						parent_task_id: task.parent_task_id ?? undefined,
						is_template: task.is_template,
						recurrence_base_date: meta.recurrence_base_date,
						completed_at: meta.completed_at,
						next_occurrence_date: meta.next_occurrence_date,
						completed_occurrences_count: meta.completed_occurrences_count,
						reminder_date: meta.reminder_date,
						notification_sent: meta.notification_sent,
						position: task.position,
						created_at: task.created_at,
						updated_at: task.updated_at,
						deleted_at: task.deleted_at ?? undefined
					};
				})
		);

		// Decrypt subtasks
		const decryptedSubtasks: Subtask[] = await Promise.all(
			(allSubtasks as SubtaskStoredLocal[])
				.filter((s) => !s.deleted_at)
				.map(async (subtask) => {
					const title = await cryptoManager.decryptText(subtask.name_encrypted);
					let isCompleted = subtask.is_completed === 1;
					if (subtask.metadata_encrypted) {
						try {
							const meta = await cryptoManager.decryptObject<SubtaskSensitiveMetadata>(
								subtask.metadata_encrypted
							);
							isCompleted = meta.is_completed;
						} catch {
							// Fallback to shadow index
						}
					}
					return {
						id: subtask.id,
						task_id: subtask.task_id,
						title,
						is_completed: isCompleted,
						position: subtask.position,
						created_at: subtask.created_at,
						updated_at: subtask.updated_at
					};
				})
		);

		const exportData: ExportDataDecrypted = {
			version: DECRYPTED_EXPORT_VERSION,
			app: 'reborn-task',
			exportedAt: new Date().toISOString(),
			encrypted: false,
			data: {
				lists: decryptedLists,
				tasks: decryptedTasks,
				subtasks: decryptedSubtasks
			}
		};

		logger.info('Decrypted payload ready', {
			lists: decryptedLists.length,
			tasks: decryptedTasks.length,
			subtasks: decryptedSubtasks.length
		});

		return exportData;
	}

	/**
	 * Export all user data as decrypted (plaintext) JSON.
	 * Useful for portability and use in other applications.
	 */
	async exportDecrypted(): Promise<void> {
		const exportData = await this.buildDecryptedPayload();
		this.triggerDownload(exportData, `reborn-task-export-${this.dateStamp()}.json`);
	}

	/**
	 * Build a portable, password-encrypted backup envelope WITHOUT writing it
	 * anywhere - returns the JSON blob plus entity counts. Download-free seam
	 * shared by the manual export ({@link exportEncryptedPortable}) and the
	 * automated backup engine, which writes the bytes to the user's chosen folder
	 * instead of triggering a browser download.
	 */
	async buildPortableBackup(
		password: string
	): Promise<{ blob: Blob; counts: { lists: number; tasks: number; subtasks: number } }> {
		const payload = await this.buildDecryptedPayload();
		const { salt, iv, data } = await encryptWithPassword(JSON.stringify(payload), password);

		const envelope: PortableEncryptedExport = {
			app: 'reborn-task',
			version: PORTABLE_EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			portable: true,
			encryption: 'aes-256-gcm-pbkdf2',
			salt,
			iv,
			data
		};

		const counts = {
			lists: payload.data.lists.length,
			tasks: payload.data.tasks.length,
			subtasks: payload.data.subtasks.length
		};
		logger.info('Portable encrypted export ready', counts);

		const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
		return { blob, counts };
	}

	/**
	 * Export a portable, password-encrypted backup.
	 *
	 * Builds the same plaintext payload as {@link exportDecrypted}, then wraps it
	 * in a PBKDF2-derived AES-GCM layer keyed by the user's password. Unlike
	 * {@link exportEncrypted} (account-key, same-account-only), this backup can be
	 * imported on any account - the importer re-encrypts the payload with the
	 * target account's master key. Zero Knowledge is preserved: only the
	 * password-encrypted envelope leaves the device.
	 */
	async exportEncryptedPortable(password: string): Promise<void> {
		const { blob } = await this.buildPortableBackup(password);
		this.triggerDownloadBlob(blob, `reborn-task-backup-portable-${this.dateStamp()}.json`);
	}

	/**
	 * Export all user data as encrypted JSON.
	 *
	 * Zero Knowledge: shadow indexes (is_completed, is_starred, is_recurring,
	 * due_date, subtask is_completed) are local-only and MUST NOT be persisted
	 * outside the device. They are stripped here and rebuilt on import from
	 * `metadata_encrypted`. Only encrypted ciphertext + non-sensitive
	 * structural fields (ids, timestamps, positions, parent links) leave.
	 */
	async exportEncrypted(): Promise<void> {
		logger.info('Starting encrypted export...');

		const [allLists, allTasks, allSubtasks] = await Promise.all([
			listStore.getAll(),
			taskStore.getAll(),
			subtaskStore.getAll()
		]);

		const lists: ListEncrypted[] = allLists
			.filter((l) => !l.deleted_at)
			.map(
				(l) =>
					stripNullOptionalFields(l as unknown as Record<string, unknown>, [
						'metadata_encrypted',
						'device_id'
					]) as unknown as ListEncrypted
			);

		const tasks: TaskEncrypted[] = allTasks
			.filter((t) => !t.deleted_at)
			.map((t) => this.stripTaskShadowIndexes(t as TaskEncryptedBooleans));

		const subtasks: SubtaskEncrypted[] = (allSubtasks as SubtaskStoredLocal[])
			.filter((s) => !s.deleted_at)
			.map((s) => this.stripSubtaskShadowIndexes(s));

		const exportData: ExportDataEncrypted = {
			version: ENCRYPTED_EXPORT_VERSION,
			app: 'reborn-task',
			exportedAt: new Date().toISOString(),
			encrypted: true,
			data: { lists, tasks, subtasks }
		};

		logger.info('Encrypted export ready', {
			lists: exportData.data.lists.length,
			tasks: exportData.data.tasks.length,
			subtasks: exportData.data.subtasks.length
		});

		this.triggerDownload(exportData, `reborn-task-backup-${this.dateStamp()}.json`);
	}

	/**
	 * Drop local-only shadow indexes from a task before persisting outside
	 * the device. Mirrors the strip done before sending to the server.
	 *
	 * Also normalizes `null` → `undefined` for optional-but-not-nullable fields
	 * so `JSON.stringify` drops them entirely. Without this, legacy IDB records
	 * that hold e.g. `parent_task_id: null` would emit `"parent_task_id": null`
	 * in the file and a strict importer would reject them. See guideline 44.
	 */
	private stripTaskShadowIndexes(task: TaskEncryptedBooleans): TaskEncrypted {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { is_completed, is_starred, is_recurring, due_date, ...rest } = task;
		const out = stripNullOptionalFields(rest as unknown as Record<string, unknown>, [
			'parent_task_id',
			'description_encrypted',
			'recurrence_rule_encrypted',
			'device_id'
		]);
		return {
			...(out as unknown as Omit<TaskEncrypted, 'is_template'>),
			is_template: (task.is_template ? 1 : 0) as 0 | 1
		};
	}

	/**
	 * Drop local-only shadow index from a subtask before persisting outside
	 * the device.
	 */
	private stripSubtaskShadowIndexes(subtask: SubtaskStoredLocal): SubtaskEncrypted {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { is_completed, ...rest } = subtask;
		return stripNullOptionalFields(rest as unknown as Record<string, unknown>, [
			'metadata_encrypted',
			'device_id'
		]) as unknown as SubtaskEncrypted;
	}

	private triggerDownload(data: ExportData | PortableEncryptedExport, filename: string): void {
		const json = JSON.stringify(data, null, 2);
		this.triggerDownloadBlob(new Blob([json], { type: 'application/json' }), filename);
	}

	private triggerDownloadBlob(blob: Blob, filename: string): void {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		// Defer revoke so the browser has time to start the download.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	private dateStamp(): string {
		return new Date().toISOString().slice(0, 10);
	}
}

export const dataExportService = new DataExportService();
