import { z } from 'zod';
import { SyncableEncryptedEntitySchema } from '../base';

export const FolderDecryptedSchema = z.object({
  id: z.string().uuid(),
  // Server (Prisma) returns `null` for root folders; client code uses `undefined`.
  // Both are valid wire representations of "no parent".
  parent_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  // Palette / icon KEYS from the client's closed sets (FolderSensitiveMetadata),
  // not a hex value - the shade is chosen per theme at render time.
  color: z.string().max(32).optional(),
  icon: z.string().max(64).optional(),
  // Archive marker from the encrypted bundle (ISO timestamp).
  archived_at: z.string().max(40).optional(),
  order_index: z.number().int().min(0),
  is_archived: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().optional()
});

export const FolderEncryptedSchema = SyncableEncryptedEntitySchema.extend({
  // Server (Prisma) returns `null` for root folders; client code uses `undefined`.
  // Both are valid wire representations of "no parent".
  parent_id: z.string().uuid().nullable().optional(),
  name_encrypted: z.string(),
  metadata_encrypted: z.string().optional(), // FolderSensitiveMetadata (color, icon, archive marker)
  order_index: z.number().int().min(0),
  is_archived: z.boolean()
});

export const FolderWithChildrenSchema: z.ZodType<any> = FolderDecryptedSchema.extend({
  children: z.lazy(() => FolderWithChildrenSchema.array().optional())
});

// Export inferred types
export type FolderDecrypted = z.infer<typeof FolderDecryptedSchema>;
export type FolderEncrypted = z.infer<typeof FolderEncryptedSchema>;
export type FolderWithChildren = z.infer<typeof FolderWithChildrenSchema>;
