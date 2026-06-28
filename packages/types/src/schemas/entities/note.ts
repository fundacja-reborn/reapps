import { z } from 'zod';
import { SyncableEncryptedEntitySchema } from '../base';

/**
 * Schema for PeriodicNoteMetadata — see entities/note.ts for semantics.
 * `anchor` is an ISO `YYYY-MM-DD` (10 chars, deterministic), locale-independent.
 */
export const PeriodicNoteMetadataSchema = z.object({
  kind: z.enum(['daily', 'weekly', 'monthly']),
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

/**
 * Schema for NoteSensitiveMetadata — bundled into metadata_encrypted
 */
export const NoteSensitiveMetadataSchema = z.object({
  is_starred: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  periodic: PeriodicNoteMetadataSchema.optional()
});

/**
 * Schema for decrypted note
 */
export const NoteDecryptedSchema = z.object({
  id: z.string().uuid(),
  // Server (Prisma) returns `null` for root-level notes; client code uses `undefined`.
  // Both are valid wire representations of "no folder".
  folder_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  is_pinned: z.boolean().optional(),
  is_starred: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().optional()
});

/**
 * Schema for encrypted note (wire format — no plaintext sensitive data)
 */
export const NoteEncryptedSchema = SyncableEncryptedEntitySchema.extend({
  // Server (Prisma) returns `null` for root-level notes; client code uses `undefined`.
  // Both are valid wire representations of "no folder".
  folder_id: z.string().uuid().nullable().optional(),
  title_encrypted: z.string().min(1),
  content_encrypted: z.string(),
  metadata_encrypted: z.string().optional(), // Contains NoteSensitiveMetadata
  is_archived: z.boolean().optional()        // Operational — stays plain
});

/**
 * Schema for NoteStoredLocal — extends encrypted with local shadow indexes
 */
export const NoteStoredLocalSchema = NoteEncryptedSchema.extend({
  is_pinned: z.boolean().optional(),
  is_starred: z.boolean().optional(),
  // Local-only: reason the last push was permanently rejected (paired with
  // sync_status: 'sync_error'). Never sent to the server. See SyncErrorCode.
  sync_error_code: z.enum(['too_large', 'quota_exceeded', 'invalid', 'rejected']).optional(),
  // Local-only: pristine untouched "new note" whose push is deferred until the
  // first deliberate action. Never sent to the server. See issue #349.
  is_ephemeral: z.boolean().optional()
});

// Export inferred types
export type NoteDecrypted = z.infer<typeof NoteDecryptedSchema>;
export type NoteEncrypted = z.infer<typeof NoteEncryptedSchema>;
export type NoteStoredLocal = z.infer<typeof NoteStoredLocalSchema>;
export type NoteSensitiveMetadata = z.infer<typeof NoteSensitiveMetadataSchema>;
export type PeriodicNoteMetadata = z.infer<typeof PeriodicNoteMetadataSchema>;
