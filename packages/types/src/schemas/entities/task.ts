import { z } from 'zod';
import { SyncableEncryptedEntitySchema } from '../base';
import { BooleanIntSchema } from '../common';

/**
 * Schema for recurrence pattern
 */
export const RecurrencePatternSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().positive(),
  days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  day_of_month: z.number().int().min(1).max(31).optional(),
  end_date: z.string().datetime().optional()
});

/**
 * Schema for TaskSensitiveMetadata — bundled into metadata_encrypted
 */
export const TaskSensitiveMetadataSchema = z.object({
  due_date: z.string().nullable().optional(),
  has_time: z.boolean().optional(),
  is_completed: z.boolean(),
  is_starred: z.boolean(),
  is_recurring: z.boolean().optional(),
  completed_at: z.string().nullable().optional(),
  reminder_date: z.string().nullable().optional(),
  next_occurrence_date: z.string().nullable().optional(),
  recurrence_base_date: z.string().nullable().optional(),
  completed_occurrences_count: z.number().int().min(0).optional(),
  notification_sent: z.boolean().optional()
});

/**
 * Schema for SubtaskSensitiveMetadata — bundled into metadata_encrypted
 */
export const SubtaskSensitiveMetadataSchema = z.object({
  is_completed: z.boolean()
});

/**
 * Schema for decrypted task (UI representation with boolean values)
 */
export const TaskDecryptedSchema = z.object({
  id: z.string().uuid(),
  task_list_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  due_date: z.string().nullable().optional(),
  has_time: z.boolean().optional(),
  is_completed: z.boolean(),
  is_starred: z.boolean(),
  is_recurring: z.boolean().optional(),
  recurrence_rule: z.string().optional(),
  // Server (Prisma) returns `null` for top-level tasks; client code uses `undefined`.
  // Both are valid wire representations of "no parent".
  parent_task_id: z.string().uuid().nullable().optional(),
  is_template: z.boolean(),
  recurrence_base_date: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  next_occurrence_date: z.string().nullable().optional(),
  completed_occurrences_count: z.number().int().min(0).optional(),
  reminder_date: z.string().nullable().optional(),
  notification_sent: z.boolean().optional(),
  subtasks: z.array(z.lazy(() => SubtaskSchema)).optional(),
  position: z.number().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().optional()
});

/**
 * Schema for encrypted task (wire format — no plaintext sensitive data)
 */
export const TaskEncryptedSchema = SyncableEncryptedEntitySchema.extend({
  task_list_id: z.string().uuid(),
  title_encrypted: z.string().min(1),
  description_encrypted: z.string().optional(),
  metadata_encrypted: z.string(),  // Required — contains TaskSensitiveMetadata
  recurrence_rule_encrypted: z.string().optional(),
  // Server (Prisma) returns `null` for top-level tasks; client code uses `undefined`.
  // Both are valid wire representations of "no parent".
  parent_task_id: z.string().uuid().nullable().optional(),
  is_template: BooleanIntSchema,
  position: z.number().min(0)
});

/**
 * Schema for TaskStoredLocal — extends encrypted with local shadow indexes
 */
export const TaskStoredLocalSchema = TaskEncryptedSchema.extend({
  is_completed: BooleanIntSchema,
  is_starred: BooleanIntSchema,
  is_recurring: BooleanIntSchema.optional(),
  due_date: z.string().nullable().optional()
});

/**
 * Schema for task with boolean fields (for UI usage)
 * Transforms BooleanInt shadow indexes to boolean
 */
export const TaskEncryptedBooleansSchema = TaskStoredLocalSchema.extend({
  is_completed: z.boolean(),
  is_starred: z.boolean(),
  is_recurring: z.boolean().optional(),
  is_template: z.boolean()
});

/**
 * Schema for subtask
 */
export const SubtaskSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  title: z.string().min(1),
  is_completed: z.boolean(),
  position: z.number().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

/**
 * Schema for encrypted subtask (wire format)
 */
export const SubtaskEncryptedSchema = SyncableEncryptedEntitySchema.extend({
  task_id: z.string().uuid(),
  name_encrypted: z.string().min(1),
  metadata_encrypted: z.string().optional(),  // Contains SubtaskSensitiveMetadata
  position: z.number().min(0)
});

/**
 * Schema for SubtaskStoredLocal — extends encrypted with local shadow index
 */
export const SubtaskStoredLocalSchema = SubtaskEncryptedSchema.extend({
  is_completed: BooleanIntSchema
});

// Export inferred types
export type TaskDecrypted = z.infer<typeof TaskDecryptedSchema>;
export type TaskEncrypted = z.infer<typeof TaskEncryptedSchema>;
export type TaskStoredLocal = z.infer<typeof TaskStoredLocalSchema>;
export type TaskEncryptedBooleans = z.infer<typeof TaskEncryptedBooleansSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type SubtaskEncrypted = z.infer<typeof SubtaskEncryptedSchema>;
export type SubtaskStoredLocal = z.infer<typeof SubtaskStoredLocalSchema>;
export type RecurrencePattern = z.infer<typeof RecurrencePatternSchema>;
export type TaskSensitiveMetadata = z.infer<typeof TaskSensitiveMetadataSchema>;
export type SubtaskSensitiveMetadata = z.infer<typeof SubtaskSensitiveMetadataSchema>;

// Legacy type aliases for compatibility
export type Task = TaskDecrypted;
export type DecryptedTask = TaskDecrypted;
export type EncryptedTask = TaskEncrypted;
export type DecryptedSubTask = Subtask;
export type EncryptedSubTask = SubtaskEncrypted;
