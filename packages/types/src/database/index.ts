import { z } from 'zod';
import { BooleanIntSchema } from '../common';

/**
 * Database schema for TaskList - matches Prisma schema exactly
 */
export const TaskListDatabaseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name_encrypted: z.string(),
  metadata_encrypted: z.string().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().optional(),
  is_default: z.boolean(),
  position: z.number(),
  sync_version: z.number().int()
});

/**
 * Database schema for Task - matches Prisma schema exactly.
 * Sensitive behavioral metadata (due_date, is_completed, is_starred, etc.)
 * is bundled inside metadata_encrypted — never stored as plain columns.
 */
export const TaskDatabaseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  task_list_id: z.string(),
  title_encrypted: z.string(),
  description_encrypted: z.string().nullable().optional(),
  metadata_encrypted: z.string(),  // Required — contains TaskSensitiveMetadata
  recurrence_rule_encrypted: z.string().nullable().optional(),
  parent_task_id: z.string().nullable().optional(),
  is_template: BooleanIntSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().optional(),
  position: z.number(),
  sync_version: z.number().int()
});

// Export types
export type TaskListDatabase = z.infer<typeof TaskListDatabaseSchema>;
export type TaskDatabase = z.infer<typeof TaskDatabaseSchema>;

// Helper types for API responses
export type TaskListApiResponse = Omit<TaskListDatabase, 'deleted_at'> & { 
  deleted_at: string | null;
  is_synced?: boolean; // Added by API layer
};

export type TaskApiResponse = Omit<TaskDatabase, 'deleted_at' | 'description_encrypted' | 'metadata_encrypted' | 'recurrence_rule_encrypted' | 'parent_task_id'> & {
  deleted_at: string | null;
  description_encrypted: string | null;
  metadata_encrypted: string;
  recurrence_rule_encrypted: string | null;
  parent_task_id: string | null;
  is_synced?: boolean; // Added by API layer
  list_id?: string; // Alias for task_list_id
};
