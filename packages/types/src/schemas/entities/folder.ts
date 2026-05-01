import { z } from 'zod';
import { SyncableEncryptedEntitySchema } from '../base';

export const FolderDecryptedSchema = z.object({
  id: z.string().uuid(),
  // Server (Prisma) returns `null` for root folders; client code uses `undefined`.
  // Both are valid wire representations of "no parent".
  parent_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  icon: z.string().optional(),
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
  metadata_encrypted: z.string().optional(), // color, icon etc.
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
