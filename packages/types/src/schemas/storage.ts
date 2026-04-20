import { z } from 'zod';

/**
 * Schema for sync state
 */
export const SyncStateSchema = z.object({
  id: z.string(),
  lastSyncTimestamp: z.number().int().min(0),
  version: z.number().int().min(0)
});

/**
 * Schema for ID mapping
 */
export const IdMappingSchema = z.object({
  id: z.string(),
  oldId: z.string(),
  newId: z.string(),
  entityType: z.enum(['tasklist', 'task', 'subtask', 'folder', 'note', 'tag']),
  migratedAt: z.string().datetime()
});

/**
 * Schema for offline operation
 */
export const OfflineOperationSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  operation: z.enum(['create', 'update', 'delete']),
  data: z.unknown(),
  createdAt: z.string().datetime(),
  retryCount: z.number().int().min(0).optional(),
  lastError: z.string().optional()
});

/**
 * Operation type enum
 */
export const OperationTypeSchema = z.enum(['create', 'update', 'delete']);

/**
 * Entity type enum
 */
export const EntityTypeSchema = z.enum(['task_list', 'task', 'sub_task']);

/**
 * Operation status enum
 */
export const OperationStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);

/**
 * Schema for extended offline operation
 */
export const ExtendedOfflineOperationSchema = OfflineOperationSchema.extend({
  type: OperationTypeSchema,
  entityType: EntityTypeSchema,
  timestamp: z.number().int().min(0),
  updated_at: z.number().int().min(0).optional(),
  status: OperationStatusSchema.optional(),
  error: z.string().optional(),
  last_error_time: z.number().int().min(0).optional(),
  priority: z.number().int().optional(),
  dependencies: z.array(z.string()).optional()
});

/**
 * Schema for sync metadata
 */
export const SyncMetadataSchema = z.object({
  lastSyncTime: z.number().int().min(0),
  syncInProgress: z.boolean(),
  pendingOperationsCount: z.number().int().min(0),
  failedOperationsCount: z.number().int().min(0)
});

/**
 * Schema for sync status
 */
export const SyncStatusSchema = z.object({
  online: z.boolean(),
  lastSyncTime: z.number().int().min(0).nullable(),
  pendingChanges: z.number().int().min(0),
  syncInProgress: z.boolean(),
  syncError: z.string().nullable()
});

/**
 * Schema for sync operation result
 */
export const SyncOperationResultSchema = z.object({
  success: z.boolean(),
  operationId: z.string(),
  error: z.string().optional(),
  serverData: z.unknown().optional(),
  timestamp: z.number().int().min(0)
});

/**
 * Schema for data conflict
 */
export const DataConflictSchema = z.object({
  entityType: EntityTypeSchema,
  entityId: z.string(),
  localData: z.unknown(),
  serverData: z.unknown(),
  timestamp: z.number().int().min(0),
  resolved: z.boolean(),
  resolution: z.enum(['local', 'server', 'merged']).optional()
});

/**
 * Schema for sync options
 */
export const SyncOptionsSchema = z.object({
  force: z.boolean().optional(),
  entitiesOnly: z.array(EntityTypeSchema).optional(),
  resolveDuplicates: z.boolean().optional(),
  resolveConflicts: z.boolean().optional(),
  timeout: z.number().int().positive().optional()
});

/**
 * Legacy stored task schema
 */
export const StoredTaskSchema = z
  .object({
    id: z.string(),
    task_list_id: z.string(),
    title_encrypted: z.string(),
    description_encrypted: z.string().nullable(),
    due_date: z.string().nullable(),
    has_time: z.boolean(),
    is_completed: z.union([z.literal(0), z.literal(1)]),
    completed_at: z.string().nullable(),
    next_occurrence_date: z.string().nullable(),
    is_starred: z.union([z.literal(0), z.literal(1)]),
    is_recurring: z.union([z.literal(0), z.literal(1)]),
    recurrence_rule_encrypted: z.string().nullable(),
    parent_task_id: z.string().optional(),
    is_template: z.union([z.literal(0), z.literal(1)]),
    recurrence_base_date: z.string().optional(),
    completed_occurrences_count: z.number().int().min(0),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    synced_at: z.string().datetime().optional(),
    server_id: z.string().optional()
  })
  .passthrough(); // Allow additional properties

/**
 * Legacy stored subtask schema
 */
export const StoredSubTaskSchema = z
  .object({
    id: z.string(),
    task_id: z.string(),
    name_encrypted: z.string(),
    is_completed: z.boolean(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    order: z.number().int().min(0),
    entity_type: z.literal('subtask').optional(),
    synced_at: z.string().datetime().optional(),
    server_id: z.string().optional()
  })
  .passthrough(); // Allow additional properties

/**
 * Schema for task update
 */
export const TaskUpdateSchema = z
  .object({
    title_encrypted: z.string().optional(),
    description_encrypted: z.string().nullable().optional(),
    due_date: z.string().nullable().optional(),
    has_time: z.boolean().optional(),
    is_completed: z.union([z.literal(0), z.literal(1)]).optional(),
    is_starred: z.union([z.literal(0), z.literal(1)]).optional(),
    is_recurring: z.union([z.literal(0), z.literal(1)]).optional(),
    recurrence_rule_encrypted: z.string().nullable().optional(),
    parent_task_id: z.string().optional(),
    is_template: z.union([z.literal(0), z.literal(1)]).optional(),
    recurrence_base_date: z.string().optional(),
    task_list_id: z.string().optional()
  })
  .passthrough(); // Allow additional properties

// Export inferred types
export type SyncState = z.infer<typeof SyncStateSchema>;
export type IdMapping = z.infer<typeof IdMappingSchema>;
export type OfflineOperation = z.infer<typeof OfflineOperationSchema>;
export type OperationType = z.infer<typeof OperationTypeSchema>;
export type EntityType = z.infer<typeof EntityTypeSchema>;
export type OperationStatus = z.infer<typeof OperationStatusSchema>;
export type ExtendedOfflineOperation = z.infer<typeof ExtendedOfflineOperationSchema>;
export type SyncMetadata = z.infer<typeof SyncMetadataSchema>;
export type SyncStatus = z.infer<typeof SyncStatusSchema>;
export type SyncOperationResult = z.infer<typeof SyncOperationResultSchema>;
export type DataConflict = z.infer<typeof DataConflictSchema>;
export type SyncOptions = z.infer<typeof SyncOptionsSchema>;
export type StoredTask = z.infer<typeof StoredTaskSchema>;
export type StoredSubTask = z.infer<typeof StoredSubTaskSchema>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;

// Legacy type aliases
export type StorageOfflineOperation = ExtendedOfflineOperation;
