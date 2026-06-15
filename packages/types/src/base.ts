/**
 * Base interface for all encrypted entities in the system
 */
export interface EncryptedEntity {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/**
 * Interface for entities that support synchronization
 */
export interface Syncable {
  sync_version: number;
  // 'sync_error' marks an entity whose push was permanently rejected by the
  // server (a 4xx the client cannot fix by retrying). It is dropped from the
  // periodic-push retry set so a poisoned record stops re-sending forever.
  // Produced by reborn-notes (per-note hard rejections) and reborn-task (a
  // permanently-rejected operation is dead-lettered and its entity marked).
  sync_status: 'pending' | 'synced' | 'conflict' | 'sync_error';
  last_sync_at?: string | null;
  synced_at?: string | null; // Legacy compatibility
  server_id?: string;
  device_id?: string;
}

/**
 * Reason an entity's push was permanently rejected by the server (a 4xx the
 * client cannot fix by retrying). Stored only locally (IndexedDB) alongside
 * `sync_status: 'sync_error'`; never sent to the server.
 *  - `too_large`: encrypted body exceeded the request size limit (413).
 *  - `quota_exceeded`: per-user storage quota is full (413 QUOTA_EXCEEDED).
 *  - `invalid`: server-side Zod validation rejected the payload (400).
 *  - `rejected`: other permanent rejection (e.g. 403 ownership).
 *
 * Lives in `base` rather than a single entity module because both apps now
 * produce it (notes per-note, task per-operation).
 */
export type SyncErrorCode = 'too_large' | 'quota_exceeded' | 'invalid' | 'rejected';

/**
 * Combined interface for encrypted and syncable entities
 */
export interface SyncableEncryptedEntity extends EncryptedEntity, Syncable {}
