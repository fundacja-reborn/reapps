import type { SyncableEncryptedEntity, SyncErrorCode } from '../base';
import type { BooleanInt } from '../common';

// ─── Size limits ────────────────────────────────────────────────────

/** Maximum plaintext task title size in bytes — enforced client-side. */
export const MAX_TASK_TITLE_BYTES = 1_000; // 1 KB

/** Maximum plaintext task description size in bytes — enforced client-side. */
export const MAX_TASK_DESCRIPTION_BYTES = 10_000; // 10 KB

/** Maximum encrypted task title size in bytes — enforced server-side via Zod. */
export const MAX_ENCRYPTED_TASK_TITLE_BYTES = 1_500;

/** Maximum encrypted task description size in bytes — enforced server-side via Zod. */
export const MAX_ENCRYPTED_TASK_DESCRIPTION_BYTES = 15_000;

/** Maximum plaintext subtask name size in bytes — enforced client-side. */
export const MAX_SUBTASK_NAME_BYTES = 1_000; // 1 KB

/** Maximum encrypted subtask name size in bytes — enforced server-side via Zod. */
export const MAX_ENCRYPTED_SUBTASK_NAME_BYTES = 1_500;

/** Maximum plaintext list name size in bytes — enforced client-side. */
export const MAX_LIST_NAME_BYTES = 500;

/** Maximum encrypted list name size in bytes — enforced server-side via Zod. */
export const MAX_ENCRYPTED_LIST_NAME_BYTES = 750;

// ─── Sensitive metadata bundles (encrypted, never sent as plaintext) ──

/** Behavioral metadata bundled into metadata_encrypted for zero-knowledge. */
export interface TaskSensitiveMetadata {
  due_date?: string | null;
  has_time?: boolean;
  is_completed: boolean;
  is_starred: boolean;
  is_recurring?: boolean;
  completed_at?: string | null;
  reminder_date?: string | null;
  next_occurrence_date?: string | null;
  recurrence_base_date?: string | null;
  completed_occurrences_count?: number;
  notification_sent?: boolean;
}

/** Subtask behavioral metadata bundled into metadata_encrypted. */
export interface SubtaskSensitiveMetadata {
  is_completed: boolean;
}

// ─── Decrypted types (UI representation) ─────────────────────────────

export interface TaskDecrypted {
  id: string;
  task_list_id: string;
  title: string;
  description?: string;
  due_date?: string | null;
  has_time?: boolean;
  is_completed: boolean;
  is_starred: boolean;
  is_recurring?: boolean;
  recurrence_rule?: string;
  parent_task_id?: string;
  is_template: boolean;
  recurrence_base_date?: string | null;
  completed_at?: string | null;
  next_occurrence_date?: string | null;
  completed_occurrences_count?: number;
  reminder_date?: string | null;
  notification_sent?: boolean;
  subtasks?: Subtask[];
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

// ─── Encrypted types (server/sync representation — no plaintext sensitive data) ──

/** Wire format sent to/from server. Sensitive fields inside metadata_encrypted. */
export interface TaskEncrypted extends SyncableEncryptedEntity {
  task_list_id: string;
  title_encrypted: string;
  description_encrypted?: string;
  metadata_encrypted: string;            // Required — contains TaskSensitiveMetadata
  recurrence_rule_encrypted?: string;    // E2E encrypted RRULE
  parent_task_id?: string;
  is_template: BooleanInt;               // Structural, not behavioral — stays plain
  position: number;
}

export interface SubtaskEncrypted extends SyncableEncryptedEntity {
  task_id: string;
  name_encrypted: string;
  metadata_encrypted?: string;           // Contains SubtaskSensitiveMetadata
  position: number;
}

// ─── Local storage types (IndexedDB — shadow indexes for queries) ────

/** Extended with local-only shadow indexes extracted from decrypted metadata. */
export interface TaskStoredLocal extends TaskEncrypted {
  is_completed: BooleanInt;
  is_starred: BooleanInt;
  is_recurring?: BooleanInt;
  due_date?: string | null;
  /**
   * Set when the last push of this task's operation was permanently rejected
   * (see `SyncErrorCode`). Always paired with `sync_status: 'sync_error'`.
   * Local-only, never sent to the server. Cleared on a successful push, or
   * whenever a local edit re-marks the task 'pending'.
   */
  sync_error_code?: SyncErrorCode;
}

/** Extended with local-only shadow index for subtask completion. */
export interface SubtaskStoredLocal extends SubtaskEncrypted {
  is_completed: BooleanInt;
}

// ─── Other types ─────────────────────────────────────────────────────

export interface RecurrencePattern {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  days_of_week?: number[];
  day_of_month?: number;
  end_date?: string;
}

/** UI usage — converts BooleanInt shadow indexes back to boolean. */
export interface TaskEncryptedBooleans extends Omit<TaskStoredLocal, 'is_completed' | 'is_starred' | 'is_recurring' | 'is_template'> {
  is_completed: boolean;
  is_starred: boolean;
  is_recurring?: boolean;
  is_template: boolean;
}

// Legacy types for compatibility
export type Task = TaskDecrypted;
export type DecryptedTask = TaskDecrypted;
export type EncryptedTask = TaskEncrypted;
export type DecryptedSubTask = Subtask;
export type EncryptedSubTask = SubtaskEncrypted;
