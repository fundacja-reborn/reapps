import { taskStore, listStore, subtaskStore, addOperation } from '@reborn/storage';
import {
	cryptoManager,
	deriveKeyFromPassword,
	decryptData,
	base64ToArrayBuffer,
	isEncryptedDataReadable
} from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { schemas } from '@reborn/types';
import { get } from 'svelte/store';
import { user } from '$lib/stores/auth.store';
import { t } from '$lib/stores/i18n.store';
import { taskCounts } from '$lib/stores/task-counts.store';
import { taskIndex } from './task-title-index.svelte';
import { remapPortableIds } from './portable-import-utils';
import type { ExportData, PortableEncryptedExport } from './data-export.service';
import type {
	ListEncrypted,
	TaskEncrypted,
	TaskEncryptedBooleans,
	TaskSensitiveMetadata,
	SubtaskEncrypted,
	SubtaskStoredLocal,
	SubtaskSensitiveMetadata
} from '@reborn/types';

const logger = createLogger('DataImportService');

/** Max import file size: 100 MB (aligned with per-user storage quota). */
const MAX_IMPORT_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Normalize `null` → `undefined` for fields that are optional-but-not-nullable
 * downstream. Server (Prisma) and legacy local IDB records may carry `null` for
 * "no parent / no metadata"; the rest of the client code uses `undefined` as
 * the canonical absence marker. Without this, Zod's optional() rejects null
 * and otherwise-valid backups fail validation. Mirrors the helper of the same
 * name in reborn-notes export-import.service.ts.
 */
function normalizeNullToUndefined(
	raw: Record<string, unknown>,
	fields: readonly string[]
): Record<string, unknown> {
	const out = { ...raw };
	for (const field of fields) {
		if (out[field] === null) {
			out[field] = undefined;
		}
	}
	return out;
}

/** Optional-but-not-nullable fields per entity type. */
const LIST_OPTIONAL_FIELDS = ['metadata_encrypted', 'device_id'] as const;
const TASK_OPTIONAL_FIELDS = [
	'parent_task_id',
	'description_encrypted',
	'recurrence_rule_encrypted',
	'device_id'
] as const;
const SUBTASK_OPTIONAL_FIELDS = ['metadata_encrypted', 'device_id'] as const;

/**
 * The current account is authoritative for `user_id`; the value carried in the
 * file is irrelevant (we overwrite it on save anyway). Setting it before
 * `safeParse` lets legacy backups with null/missing/invalid user_id — produced
 * by older client builds or by a sync pull racing auth restoration — pass
 * Zod's `z.string().uuid()` check. Same behavior on cross-account imports:
 * ownership transfers to the importing user. See guideline 44.
 *
 * Returns the input unchanged for non-record inputs; the subsequent
 * `safeParse` will reject those with its own type error.
 */
function withUserId(raw: unknown, userId: string): unknown {
	if (typeof raw !== 'object' || raw === null) return raw;
	return { ...(raw as Record<string, unknown>), user_id: userId };
}

/**
 * Format a Zod safeParse failure into a single human-readable message.
 * `issues[0]?.message` on its own returns "Invalid input" with no field
 * context — useless for triage. Concatenating path + message per issue
 * makes the UI report actionable. Mirrors `formatZodIssues` in reborn-notes.
 */
function formatZodIssues(error: {
	issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
	return error.issues
		.map((i) => {
			const path = i.path.join('.');
			return path ? `${path}: ${i.message}` : i.message;
		})
		.join('; ');
}

export interface ImportResult {
	listsImported: number;
	tasksImported: number;
	subtasksImported: number;
	skipped: number;
	errors: string[];
}

export class DataImportService {
	/**
	 * Import data from a JSON File object produced by a file input.
	 * Handles decrypted, account-key encrypted, and portable
	 * (password-encrypted) export formats. For a portable backup the caller must
	 * supply the `password` used at export time.
	 */
	async importFromFile(file: File, password?: string): Promise<ImportResult> {
		if (file.size > MAX_IMPORT_FILE_SIZE) {
			throw new Error(
				`Rozmiar pliku (${Math.round(file.size / 1024 / 1024)} MB) przekracza limit ${Math.round(MAX_IMPORT_FILE_SIZE / 1024 / 1024)} MB.`
			);
		}
		const text = await file.text();
		return this.importFromText(text, password);
	}

	/**
	 * Import from already-read file text. A portable, password-encrypted envelope
	 * is decrypted (with `password`) to a plaintext ExportDataDecrypted first;
	 * the decrypted-import path then re-encrypts every record with the CURRENT
	 * account key, which is what makes a portable backup land on any account.
	 */
	async importFromText(text: string, password?: string): Promise<ImportResult> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error('Nieprawidłowy format pliku - oczekiwano JSON');
		}

		// A portable backup is explicitly cross-account ("import on any account"),
		// so its records must be re-keyed AND re-id'd on import; a plain decrypted
		// or account-key-encrypted file is a same-account restore that keeps IDs.
		// (The guard stays in the `if` so it narrows `parsed` to the envelope type.)
		let portable = false;
		if (this.isPortableEncryptedExport(parsed)) {
			portable = true;
			if (!password) {
				throw new Error('Ten backup jest zaszyfrowany. Podaj hasło.');
			}
			parsed = await this.decryptPortableEnvelope(parsed, password);
		}

		if (!this.isValidExportData(parsed)) {
			throw new Error(
				'Plik nie jest prawidłowym eksportem reborn-task (brak pól version/app/data)'
			);
		}

		const exportData = parsed as ExportData;

		if (!cryptoManager.isInitialized()) {
			throw new Error('CryptoManager nie jest zainicjalizowany');
		}

		const currentUser = get(user);
		if (!currentUser?.id) {
			throw new Error('Użytkownik nie jest zalogowany');
		}

		logger.info('Starting import', {
			encrypted: exportData.encrypted,
			lists: exportData.data.lists.length,
			tasks: exportData.data.tasks.length,
			subtasks: exportData.data.subtasks.length
		});

		const result: ImportResult = { listsImported: 0, tasksImported: 0, subtasksImported: 0, skipped: 0, errors: [] };

		if (exportData.encrypted) {
			// Encrypted format — save raw encrypted data
			await this.importEncrypted(exportData, currentUser.id, result);
		} else {
			// Decrypted format — encrypt each item before saving. `portable` forces
			// fresh IDs (cross-account); a same-account decrypted restore keeps them.
			await this.importDecrypted(exportData, currentUser.id, result, portable);
		}

		logger.info('Import complete', result);
		// Rebuild in-memory title index so imported tasks are immediately
		// visible in the UI without requiring a reload.
		try {
			await taskIndex.rebuild();
		} catch (e: unknown) {
			logger.warn('Failed to rebuild task index after import', e);
		}
		await taskCounts.refresh();
		return result;
	}

	/**
	 * True if `text` is a portable, password-encrypted reborn-task backup. The
	 * UI calls this before importing to know whether to prompt for a password.
	 */
	isPortableEncryptedText(text: string): boolean {
		try {
			return this.isPortableEncryptedExport(JSON.parse(text));
		} catch {
			return false;
		}
	}

	private isPortableEncryptedExport(parsed: unknown): parsed is PortableEncryptedExport {
		if (typeof parsed !== 'object' || parsed === null) return false;
		const p = parsed as Record<string, unknown>;
		return (
			p.app === 'reborn-task' &&
			p.portable === true &&
			typeof p.encryption === 'string' &&
			typeof p.salt === 'string' &&
			typeof p.iv === 'string' &&
			typeof p.data === 'string'
		);
	}

	private async decryptPortableEnvelope(
		envelope: PortableEncryptedExport,
		password: string
	): Promise<unknown> {
		const salt = base64ToArrayBuffer(envelope.salt);
		const iv = base64ToArrayBuffer(envelope.iv);
		const ciphertext = base64ToArrayBuffer(envelope.data);
		const key = await deriveKeyFromPassword(password, salt);
		let decrypted: string;
		try {
			decrypted = (await decryptData(ciphertext, key, iv, 'string')) as string;
		} catch {
			throw new Error('Nieprawidłowe hasło lub uszkodzony plik backupu.');
		}
		try {
			return JSON.parse(decrypted);
		} catch {
			throw new Error('Uszkodzony plik backupu.');
		}
	}

	private async importEncrypted(
		exportData: ExportData & { encrypted: true },
		userId: string,
		result: ImportResult
	): Promise<void> {
		// An account-key encrypted backup is readable only on the account that
		// created it. Imported elsewhere every field fails the AES-GCM auth check,
		// so the old code saved untouched ciphertext that showed as blank rows and
		// then sync-rejected on push (PK collision / 403). Probe one ciphertext per
		// entity kind; if NONE decrypt, stop with a clear message pointing at the
		// portable (password) backup - the supported cross-account path. A
		// same-account restore decrypts on the first probe and proceeds. (Portable
		// and decrypted imports never reach here: they carry plaintext re-encrypted
		// with the current key.)
		const readable = await isEncryptedDataReadable(
			[
				exportData.data.lists[0]?.name_encrypted,
				exportData.data.tasks[0]?.title_encrypted,
				exportData.data.subtasks[0]?.name_encrypted
			],
			(ciphertext) => cryptoManager.decryptText(ciphertext)
		);
		if (!readable) {
			throw new Error(get(t)('settings.import_export.import_cross_account_error'));
		}

		const now = new Date().toISOString();

		for (const list of exportData.data.lists) {
			try {
				const normalized = withUserId(
					normalizeNullToUndefined(
						list as unknown as Record<string, unknown>,
						LIST_OPTIONAL_FIELDS
					),
					userId
				);
				const parsed = schemas.ListEncryptedSchema.safeParse(normalized);
				if (!parsed.success) {
					result.errors.push(`Lista ${list.id}: walidacja — ${formatZodIssues(parsed.error)}`);
					continue;
				}
				const existing = await listStore.get(parsed.data.id);
				if (existing && existing.updated_at >= parsed.data.updated_at) {
					result.skipped++;
					continue;
				}
				const toSave: ListEncrypted = {
					...parsed.data,
					user_id: userId,
					sync_status: 'pending',
					sync_version: 0,
					updated_at: now
				};
				await listStore.save(toSave);
				await addOperation({
					type: existing ? 'update' : 'create',
					entityType: 'task_list',
					entityId: toSave.id,
					data: toSave
				});
				result.listsImported++;
			} catch (e: unknown) {
				result.errors.push(`Lista ${list.id}: ${e instanceof Error ? e.message : 'błąd'}`);
			}
		}

		for (const rawTask of exportData.data.tasks) {
			try {
				// Normalize legacy v1.0 fields (boolean is_template, shadow indexes)
				// to wire-format before validation. Both stripped shadow indexes
				// and is_template normalized to 0|1 for TaskEncryptedSchema.
				const wireCandidate = withUserId(this.normalizeTaskToWire(rawTask), userId);
				const parsed = schemas.TaskEncryptedSchema.safeParse(wireCandidate);
				if (!parsed.success) {
					result.errors.push(
						`Zadanie ${(rawTask as { id?: string }).id ?? '?'}: walidacja — ${formatZodIssues(parsed.error)}`
					);
					continue;
				}
				const existing = await taskStore.get(parsed.data.id);
				if (existing && existing.updated_at >= parsed.data.updated_at) {
					result.skipped++;
					continue;
				}

				// Rebuild shadow indexes from metadata_encrypted (Zero Knowledge:
				// shadow indexes are local-only and never trusted from a file).
				const wire: TaskEncrypted = {
					...parsed.data,
					parent_task_id: parsed.data.parent_task_id ?? undefined,
					user_id: userId,
					sync_status: 'pending',
					sync_version: 0,
					updated_at: now
				};
				const toSave = await this.rebuildTaskShadowIndexes(wire);
				await taskStore.save(toSave);
				await addOperation({
					type: existing ? 'update' : 'create',
					entityType: 'task',
					entityId: toSave.id,
					data: wire
				});
				result.tasksImported++;
			} catch (e: unknown) {
				result.errors.push(
					`Zadanie ${(rawTask as { id?: string }).id ?? '?'}: ${e instanceof Error ? e.message : 'błąd'}`
				);
			}
		}

		for (const rawSubtask of exportData.data.subtasks) {
			try {
				// Strip legacy shadow index before validating against wire schema.
				const wireCandidate = withUserId(this.normalizeSubtaskToWire(rawSubtask), userId);
				const parsed = schemas.SubtaskEncryptedSchema.safeParse(wireCandidate);
				if (!parsed.success) {
					result.errors.push(
						`Podzadanie ${(rawSubtask as { id?: string }).id ?? '?'}: walidacja — ${formatZodIssues(parsed.error)}`
					);
					continue;
				}
				const existing = await subtaskStore.get(parsed.data.id);
				if (existing && existing.updated_at >= parsed.data.updated_at) {
					result.skipped++;
					continue;
				}

				const wire: SubtaskEncrypted = {
					...parsed.data,
					user_id: userId,
					sync_status: 'pending',
					sync_version: 0,
					updated_at: now
				};
				const toSave = await this.rebuildSubtaskShadowIndexes(wire);
				await subtaskStore.save(toSave);
				await addOperation({
					type: existing ? 'update' : 'create',
					entityType: 'sub_task',
					entityId: toSave.id,
					data: wire
				});
				result.subtasksImported++;
			} catch (e: unknown) {
				result.errors.push(
					`Podzadanie ${(rawSubtask as { id?: string }).id ?? '?'}: ${e instanceof Error ? e.message : 'błąd'}`
				);
			}
		}
	}

	private async importDecrypted(
		exportData: ExportData & { encrypted: false },
		userId: string,
		result: ImportResult,
		portable = false
	): Promise<void> {
		const now = new Date().toISOString();

		// Portable (cross-account) backup: regenerate every ID and remap the FK
		// chains so the records can't collide with the source account's rows on
		// the server (a reused id 403s / hits a PK unique violation on push and
		// never syncs). A same-account restore (portable=false) keeps IDs so the
		// conflict-by-updated_at merge below can update rows in place.
		const data = portable ? remapPortableIds(exportData.data) : exportData.data;

		for (const list of data.lists) {
			try {
				const parsed = schemas.ListDecryptedSchema.safeParse(list);
				if (!parsed.success) {
					result.errors.push(`Lista ${list.id}: walidacja — ${formatZodIssues(parsed.error)}`);
					continue;
				}
				const validList = parsed.data;
				const existing = await listStore.get(validList.id);
				if (existing && existing.updated_at >= validList.updated_at) {
					result.skipped++;
					continue;
				}

				const name_encrypted = await cryptoManager.encryptText(validList.name);
				let metadata_encrypted: string | undefined;
				if (validList.color || validList.icon) {
					metadata_encrypted = await cryptoManager.encryptObject({
						color: validList.color,
						icon: validList.icon
					});
				}

				const toSave: ListEncrypted = {
					id: validList.id,
					user_id: userId,
					name_encrypted,
					metadata_encrypted,
					order_index: validList.order_index,
					is_default: validList.is_default,
					created_at: validList.created_at,
					updated_at: now,
					deleted_at: validList.deleted_at ?? null,
					sync_status: 'pending',
					sync_version: 0
				};
				await listStore.save(toSave);
				await addOperation({
					type: existing ? 'update' : 'create',
					entityType: 'task_list',
					entityId: validList.id,
					data: toSave
				});
				result.listsImported++;
			} catch (e: unknown) {
				result.errors.push(`Lista ${list.id}: ${e instanceof Error ? e.message : 'błąd'}`);
			}
		}

		for (const task of data.tasks) {
			try {
				const parsed = schemas.TaskDecryptedSchema.safeParse(task);
				if (!parsed.success) {
					result.errors.push(`Zadanie ${task.id}: walidacja — ${formatZodIssues(parsed.error)}`);
					continue;
				}
				const validTask = parsed.data;
				const existing = await taskStore.get(validTask.id);
				if (existing && existing.updated_at >= validTask.updated_at) {
					result.skipped++;
					continue;
				}

				const title_encrypted = await cryptoManager.encryptText(validTask.title);
				const description_encrypted = validTask.description
					? await cryptoManager.encryptText(validTask.description)
					: undefined;
				const recurrence_rule_encrypted = validTask.recurrence_rule
					? await cryptoManager.encryptText(validTask.recurrence_rule)
					: undefined;

				const sensitiveMetadata: TaskSensitiveMetadata = {
					is_completed: validTask.is_completed,
					is_starred: validTask.is_starred,
					is_recurring: validTask.is_recurring ?? false,
					due_date: validTask.due_date ?? null,
					has_time: validTask.has_time,
					completed_at: validTask.completed_at ?? null,
					reminder_date: validTask.reminder_date ?? null,
					next_occurrence_date: validTask.next_occurrence_date ?? null,
					recurrence_base_date: validTask.recurrence_base_date ?? null,
					completed_occurrences_count: validTask.completed_occurrences_count,
					notification_sent: validTask.notification_sent
				};
				const metadata_encrypted = await cryptoManager.encryptObject(sensitiveMetadata);

				const wire: TaskEncrypted = {
					id: validTask.id,
					user_id: userId,
					task_list_id: validTask.task_list_id,
					title_encrypted,
					description_encrypted,
					metadata_encrypted,
					recurrence_rule_encrypted,
					parent_task_id: validTask.parent_task_id ?? undefined,
					is_template: (validTask.is_template ? 1 : 0) as 0 | 1,
					position: validTask.position,
					created_at: validTask.created_at,
					updated_at: now,
					deleted_at: validTask.deleted_at ?? null,
					sync_status: 'pending',
					sync_version: 0
				};
				const toSave = await this.rebuildTaskShadowIndexes(wire);
				await taskStore.save(toSave);
				await addOperation({
					type: existing ? 'update' : 'create',
					entityType: 'task',
					entityId: validTask.id,
					data: wire
				});
				result.tasksImported++;
			} catch (e: unknown) {
				result.errors.push(`Zadanie ${task.id}: ${e instanceof Error ? e.message : 'błąd'}`);
			}
		}

		for (const subtask of data.subtasks) {
			try {
				const parsed = schemas.SubtaskSchema.safeParse(subtask);
				if (!parsed.success) {
					result.errors.push(`Podzadanie ${subtask.id}: walidacja — ${formatZodIssues(parsed.error)}`);
					continue;
				}
				const validSub = parsed.data;
				const existing = await subtaskStore.get(validSub.id);
				if (existing && existing.updated_at >= validSub.updated_at) {
					result.skipped++;
					continue;
				}

				const name_encrypted = await cryptoManager.encryptText(validSub.title);
				const metadata_encrypted = await cryptoManager.encryptObject<SubtaskSensitiveMetadata>({
					is_completed: validSub.is_completed
				});

				const wire: SubtaskEncrypted = {
					id: validSub.id,
					user_id: userId,
					task_id: validSub.task_id,
					name_encrypted,
					metadata_encrypted,
					position: validSub.position,
					created_at: validSub.created_at,
					updated_at: now,
					deleted_at: null,
					sync_status: 'pending',
					sync_version: 0
				};
				const toSave = await this.rebuildSubtaskShadowIndexes(wire);
				await subtaskStore.save(toSave);
				await addOperation({
					type: existing ? 'update' : 'create',
					entityType: 'sub_task',
					entityId: validSub.id,
					data: wire
				});
				result.subtasksImported++;
			} catch (e: unknown) {
				result.errors.push(`Podzadanie ${subtask.id}: ${e instanceof Error ? e.message : 'błąd'}`);
			}
		}
	}

	/**
	 * Normalize a raw task object from an export file to the wire-format
	 * `TaskEncrypted` shape. Strips legacy v1.0 shadow indexes and converts
	 * `is_template` boolean → 0|1. Unknown extra keys are tolerated; Zod
	 * `safeParse` strips them on validation.
	 */
	private normalizeTaskToWire(raw: unknown): unknown {
		if (typeof raw !== 'object' || raw === null) return raw;
		const r = raw as Record<string, unknown>;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { is_completed, is_starred, is_recurring, due_date, ...rest } = r;
		const out: Record<string, unknown> = { ...rest };
		if (typeof out.is_template === 'boolean') {
			out.is_template = out.is_template ? 1 : 0;
		}
		return normalizeNullToUndefined(out, TASK_OPTIONAL_FIELDS);
	}

	/**
	 * Normalize a raw subtask object to the wire-format `SubtaskEncrypted`
	 * shape. Strips legacy v1.0 `is_completed` shadow index.
	 */
	private normalizeSubtaskToWire(raw: unknown): unknown {
		if (typeof raw !== 'object' || raw === null) return raw;
		const r = raw as Record<string, unknown>;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { is_completed, ...rest } = r;
		return normalizeNullToUndefined(rest, SUBTASK_OPTIONAL_FIELDS);
	}

	/**
	 * Rebuild local shadow indexes from a task's encrypted metadata.
	 * Mirrors `SyncTasksService.rebuildShadowIndexes` so the local store
	 * has the same shape regardless of whether tasks come from server pull
	 * or import. Shadow indexes are NEVER trusted from a file — they are
	 * always rebuilt from `metadata_encrypted` (Zero Knowledge).
	 */
	private async rebuildTaskShadowIndexes(task: TaskEncrypted): Promise<TaskEncryptedBooleans> {
		try {
			if (task.metadata_encrypted && cryptoManager.isInitialized()) {
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
			}
		} catch (error: unknown) {
			logger.error(
				`METADATA_DECRYPT_FAILED for imported task ${task.id} — shadow indexes will use defaults`,
				error
			);
		}
		return {
			...task,
			is_completed: false,
			is_starred: false,
			is_template: task.is_template === 1,
			due_date: null
		} as TaskEncryptedBooleans;
	}

	/**
	 * Rebuild local shadow index from a subtask's encrypted metadata.
	 * Mirrors `SyncSubtasksService.rebuildShadowIndexes`.
	 */
	private async rebuildSubtaskShadowIndexes(
		subtask: SubtaskEncrypted
	): Promise<SubtaskStoredLocal> {
		try {
			if (subtask.metadata_encrypted && cryptoManager.isInitialized()) {
				const meta = await cryptoManager.decryptObject<SubtaskSensitiveMetadata>(
					subtask.metadata_encrypted
				);
				return {
					...subtask,
					is_completed: meta.is_completed ? 1 : 0
				} as SubtaskStoredLocal;
			}
		} catch (error: unknown) {
			logger.warn(
				`Failed to decrypt metadata for imported subtask ${subtask.id}, using defaults`,
				error
			);
		}
		return {
			...subtask,
			is_completed: 0
		} as SubtaskStoredLocal;
	}

	private isValidExportData(data: unknown): boolean {
		if (typeof data !== 'object' || data === null) return false;
		const d = data as Record<string, unknown>;
		if (d.app !== 'reborn-task') return false;
		if (!d.version || !d.exportedAt) return false;
		if (typeof d.encrypted !== 'boolean') return false;
		if (!d.data || typeof d.data !== 'object') return false;
		const inner = d.data as Record<string, unknown>;
		if (
			!Array.isArray(inner.lists) ||
			!Array.isArray(inner.tasks) ||
			!Array.isArray(inner.subtasks)
		)
			return false;
		return true;
	}
}

export const dataImportService = new DataImportService();
