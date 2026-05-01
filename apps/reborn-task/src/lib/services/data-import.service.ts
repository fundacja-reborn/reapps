import { taskStore, listStore, subtaskStore, addOperation } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { schemas } from '@reborn/types';
import { get } from 'svelte/store';
import { user } from '$lib/stores/auth.store';
import { taskCounts } from '$lib/stores/task-counts.store';
import { taskIndex } from './task-title-index.svelte';
import type { ExportData } from './data-export.service';
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
	 * Handles both encrypted and decrypted export formats.
	 */
	async importFromFile(file: File): Promise<ImportResult> {
		if (file.size > MAX_IMPORT_FILE_SIZE) {
			throw new Error(
				`Rozmiar pliku (${Math.round(file.size / 1024 / 1024)} MB) przekracza limit ${Math.round(MAX_IMPORT_FILE_SIZE / 1024 / 1024)} MB.`
			);
		}

		const text = await file.text();
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error('Nieprawidłowy format pliku — oczekiwano JSON');
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
			// Decrypted format — encrypt each item before saving
			await this.importDecrypted(exportData, currentUser.id, result);
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

	private async importEncrypted(
		exportData: ExportData & { encrypted: true },
		userId: string,
		result: ImportResult
	): Promise<void> {
		const now = new Date().toISOString();

		for (const list of exportData.data.lists) {
			try {
				const normalized = normalizeNullToUndefined(
					list as unknown as Record<string, unknown>,
					LIST_OPTIONAL_FIELDS
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
				const wireCandidate = this.normalizeTaskToWire(rawTask);
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
				const wireCandidate = this.normalizeSubtaskToWire(rawSubtask);
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
		result: ImportResult
	): Promise<void> {
		const now = new Date().toISOString();

		for (const list of exportData.data.lists) {
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

		for (const task of exportData.data.tasks) {
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
					parent_task_id: validTask.parent_task_id,
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

		for (const subtask of exportData.data.subtasks) {
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
