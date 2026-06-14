import { z } from 'zod';

/**
 * Schema for base encrypted entity
 */
export const EncryptedEntitySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().optional()
});

/**
 * Schema for syncable entity
 */
export const SyncableSchema = z.object({
  sync_version: z.number().int().min(0),
  sync_status: z.enum(['pending', 'synced', 'conflict', 'sync_error']),
  last_sync_at: z.string().datetime().nullable().optional(),
  device_id: z.string().optional()
});

/**
 * Simplified schema for database storage (without sync_status)
 */
export const DatabaseSyncableSchema = z.object({
  sync_version: z.number().int().min(0)
});

/**
 * Combined schema for encrypted and syncable entities
 */
export const SyncableEncryptedEntitySchema = EncryptedEntitySchema.merge(SyncableSchema);

/**
 * Database schema for encrypted entities with sync version
 */
export const DatabaseEncryptedEntitySchema = EncryptedEntitySchema.merge(DatabaseSyncableSchema);

// Export inferred types
export type EncryptedEntity = z.infer<typeof EncryptedEntitySchema>;
export type Syncable = z.infer<typeof SyncableSchema>;
export type SyncableEncryptedEntity = z.infer<typeof SyncableEncryptedEntitySchema>;
export type DatabaseSyncable = z.infer<typeof DatabaseSyncableSchema>;
export type DatabaseEncryptedEntity = z.infer<typeof DatabaseEncryptedEntitySchema>;
