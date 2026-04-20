import { z } from 'zod';
import { SyncableEncryptedEntitySchema } from '../base';

/**
 * Schema for NoteSensitiveMetadata — bundled into metadata_encrypted
 */
export const NoteSensitiveMetadataSchema = z.object({
  is_starred: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  tags: z.array(z.string()).optional()
});

/**
 * Schema for decrypted note
 */
export const NoteDecryptedSchema = z.object({
  id: z.string().uuid(),
  folder_id: z.string().uuid().optional(),
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
  folder_id: z.string().uuid().optional(),
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
  is_starred: z.boolean().optional()
});

// Export inferred types
export type NoteDecrypted = z.infer<typeof NoteDecryptedSchema>;
export type NoteEncrypted = z.infer<typeof NoteEncryptedSchema>;
export type NoteStoredLocal = z.infer<typeof NoteStoredLocalSchema>;
export type NoteSensitiveMetadata = z.infer<typeof NoteSensitiveMetadataSchema>;
