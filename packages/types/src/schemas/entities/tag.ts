import { z } from 'zod';
import { SyncableEncryptedEntitySchema } from '../base';

export const TagDecryptedSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const TagEncryptedSchema = SyncableEncryptedEntitySchema.extend({
  name_encrypted: z.string(),
  color_encrypted: z.string().optional()
});

export const NoteTagSchema = z.object({
  note_id: z.string().uuid(),
  tag_id: z.string().uuid(),
  created_at: z.string().datetime()
});

// Export inferred types
export type TagDecrypted = z.infer<typeof TagDecryptedSchema>;
export type TagEncrypted = z.infer<typeof TagEncryptedSchema>;
export type NoteTag = z.infer<typeof NoteTagSchema>;
