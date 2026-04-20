import { z } from 'zod';
import { SyncableEncryptedEntitySchema } from '../base';

/**
 * Schema for decrypted list
 */
export const ListDecryptedSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  icon: z.string().optional(),
  order_index: z.number().int().min(0),
  is_default: z.boolean().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().optional()
});

/**
 * Schema for encrypted list
 */
export const ListEncryptedSchema = SyncableEncryptedEntitySchema.extend({
  name_encrypted: z.string().min(1),
  metadata_encrypted: z.string().optional(), // contains encrypted color, icon etc.
  order_index: z.number().int().min(0),
  is_default: z.boolean().optional()
});

// Export inferred types
export type ListDecrypted = z.infer<typeof ListDecryptedSchema>;
export type ListEncrypted = z.infer<typeof ListEncryptedSchema>;

// Legacy type aliases for compatibility
export type TaskList = ListDecrypted;
export type DecryptedTaskList = ListDecrypted;
export type EncryptedTaskList = ListEncrypted;
export type StoredTaskList = ListEncrypted;
