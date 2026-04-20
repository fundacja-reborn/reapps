import { z } from 'zod';
import { BooleanIntSchema } from '../common';
import {
  MAX_ENCRYPTED_CONTENT_BYTES,
  MAX_ENCRYPTED_NOTE_TITLE_BYTES,
  MAX_ENCRYPTED_NOTE_METADATA_BYTES
} from '../../entities/note';
import {
  MAX_ENCRYPTED_TASK_TITLE_BYTES,
  MAX_ENCRYPTED_TASK_DESCRIPTION_BYTES,
  MAX_ENCRYPTED_SUBTASK_NAME_BYTES,
  MAX_ENCRYPTED_LIST_NAME_BYTES
} from '../../entities/task';
import { MAX_ENCRYPTED_FOLDER_NAME_BYTES } from '../../entities/folder';
import { MAX_ENCRYPTED_TAG_NAME_BYTES, MAX_ENCRYPTED_TAG_COLOR_BYTES } from '../../entities/tag';

// ─── reborn-task: Tasks ──────────────────────────────────────────────

export const CreateTaskRequestSchema = z.object({
  id: z.string().uuid().optional(),
  task_list_id: z.string().uuid(),
  title_encrypted: z.string().min(1).max(MAX_ENCRYPTED_TASK_TITLE_BYTES),
  description_encrypted: z.string().max(MAX_ENCRYPTED_TASK_DESCRIPTION_BYTES).nullable().optional(),
  metadata_encrypted: z.string(), // Required — contains TaskSensitiveMetadata
  position: z.number().optional(),
  recurrence_rule_encrypted: z.string().optional().nullable(),
  parent_task_id: z.string().uuid().optional().nullable(),
  is_template: BooleanIntSchema.optional()
});

export const UpdateTaskRequestSchema = z.object({
  title_encrypted: z.string().max(MAX_ENCRYPTED_TASK_TITLE_BYTES).optional(),
  description_encrypted: z.string().max(MAX_ENCRYPTED_TASK_DESCRIPTION_BYTES).optional().nullable(),
  metadata_encrypted: z.string().optional(),
  task_list_id: z.string().uuid().optional(),
  position: z.number().optional(),
  recurrence_rule_encrypted: z.string().optional().nullable(),
  parent_task_id: z.string().optional().nullable(),
  is_template: BooleanIntSchema.optional(),
  deleted_at: z.string().optional().nullable()
});

// ─── reborn-task: Subtasks ───────────────────────────────────────────

export const CreateSubtaskRequestSchema = z.object({
  id: z.string().uuid().optional(),
  task_id: z.string().uuid(),
  name_encrypted: z.string().min(1).max(MAX_ENCRYPTED_SUBTASK_NAME_BYTES),
  metadata_encrypted: z.string().optional(), // Contains SubtaskSensitiveMetadata
  position: z.number().optional()
});

export const UpdateSubtaskRequestSchema = z.object({
  name_encrypted: z.string().max(MAX_ENCRYPTED_SUBTASK_NAME_BYTES).optional(),
  metadata_encrypted: z.string().optional(),
  position: z.number().optional(),
  deleted_at: z.string().nullable().optional()
});

// ─── reborn-task: Task Lists ─────────────────────────────────────────

export const CreateListRequestSchema = z.object({
  id: z.string().uuid().optional(),
  name_encrypted: z.string().min(1).max(MAX_ENCRYPTED_LIST_NAME_BYTES),
  metadata_encrypted: z.string().optional().nullable(),
  order_index: z.number().int().min(0).optional(),
  is_default: z.boolean().optional()
});

export const UpdateListRequestSchema = z.object({
  name_encrypted: z.string().min(1).max(MAX_ENCRYPTED_LIST_NAME_BYTES).optional(),
  metadata_encrypted: z.string().optional().nullable(),
  order_index: z.number().int().min(0).optional(),
  is_default: z.boolean().optional()
});

export const DeleteListRequestSchema = z.object({
  deleteMode: z.enum(['soft', 'with-tasks', 'move-tasks']).optional(),
  targetListId: z.string().uuid().optional()
});

// ─── reborn-notes: Notes ─────────────────────────────────────────────

export const CreateNoteRequestSchema = z.object({
  id: z.string().uuid(),
  title_encrypted: z.string().min(1).max(MAX_ENCRYPTED_NOTE_TITLE_BYTES),
  content_encrypted: z.string().max(MAX_ENCRYPTED_CONTENT_BYTES).optional(),
  metadata_encrypted: z.string().max(MAX_ENCRYPTED_NOTE_METADATA_BYTES).optional(),
  folder_id: z.string().uuid().optional().nullable(),
  created_at: z.string().optional()
});

export const UpdateNoteRequestSchema = z.object({
  title_encrypted: z.string().max(MAX_ENCRYPTED_NOTE_TITLE_BYTES).optional(),
  content_encrypted: z.string().max(MAX_ENCRYPTED_CONTENT_BYTES).optional(),
  metadata_encrypted: z.string().max(MAX_ENCRYPTED_NOTE_METADATA_BYTES).optional(),
  folder_id: z.string().uuid().optional().nullable()
});

// ─── reborn-notes: Folders ───────────────────────────────────────────

export const CreateFolderRequestSchema = z.object({
  id: z.string().uuid(),
  name_encrypted: z.string().min(1).max(MAX_ENCRYPTED_FOLDER_NAME_BYTES),
  parent_id: z.string().uuid().optional().nullable(),
  order_index: z.number().int().min(0).optional()
});

export const UpdateFolderRequestSchema = z.object({
  name_encrypted: z.string().max(MAX_ENCRYPTED_FOLDER_NAME_BYTES).optional(),
  parent_id: z.string().uuid().optional().nullable(),
  order_index: z.number().int().min(0).optional()
});

// ─── reborn-notes: Tags ──────────────────────────────────────────────

export const CreateTagRequestSchema = z.object({
  id: z.string().uuid(),
  name_encrypted: z.string().min(1).max(MAX_ENCRYPTED_TAG_NAME_BYTES),
  color_encrypted: z.string().max(MAX_ENCRYPTED_TAG_COLOR_BYTES).optional().nullable()
});

export const UpdateTagRequestSchema = z.object({
  name_encrypted: z.string().max(MAX_ENCRYPTED_TAG_NAME_BYTES).optional(),
  color_encrypted: z.string().max(MAX_ENCRYPTED_TAG_COLOR_BYTES).optional().nullable()
});

// ─── reborn-notes: Note Tags ─────────────────────────────────────────

export const SetNoteTagsRequestSchema = z.object({
  tag_ids: z.array(z.string().uuid())
});

// ─── Inferred types ──────────────────────────────────────────────────

export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type CreateSubtaskRequest = z.infer<typeof CreateSubtaskRequestSchema>;
export type UpdateSubtaskRequest = z.infer<typeof UpdateSubtaskRequestSchema>;
export type CreateListRequest = z.infer<typeof CreateListRequestSchema>;
export type UpdateListRequest = z.infer<typeof UpdateListRequestSchema>;
export type DeleteListRequest = z.infer<typeof DeleteListRequestSchema>;
export type CreateNoteRequest = z.infer<typeof CreateNoteRequestSchema>;
export type UpdateNoteRequest = z.infer<typeof UpdateNoteRequestSchema>;
export type CreateFolderRequest = z.infer<typeof CreateFolderRequestSchema>;
export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequestSchema>;
export type CreateTagRequest = z.infer<typeof CreateTagRequestSchema>;
export type UpdateTagRequest = z.infer<typeof UpdateTagRequestSchema>;
export type SetNoteTagsRequest = z.infer<typeof SetNoteTagsRequestSchema>;
