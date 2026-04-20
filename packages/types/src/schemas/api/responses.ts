import { z } from 'zod';

/**
 * API error schema
 */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional()
});

/**
 * Pagination meta schema
 */
export const PaginationMetaSchema = z.object({
  total: z.number().int().min(0),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  pages: z.number().int().min(0)
});

/**
 * Sync meta schema
 */
export const SyncMetaSchema = z.object({
  server_time: z.string().datetime(),
  sync_token: z.string().optional(),
  has_more: z.boolean().optional()
});

/**
 * API meta schema
 */
export const ApiMetaSchema = z.object({
  pagination: PaginationMetaSchema.optional(),
  sync: SyncMetaSchema.optional()
});

/**
 * Generic API response schema
 */
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: ApiErrorSchema.optional(),
  meta: ApiMetaSchema.optional()
});

/**
 * Login response schema
 */
export const LoginResponseSchema = z.object({
  success: z.boolean(),
  user: z
    .object({
      id: z.string().uuid(),
      username: z.string(),
      encrypted_master_key: z.string().optional(),
      master_key_salt: z.string().optional(),
      encrypted_2fa_secret: z.string().optional()
    })
    .optional(),
  tokens: z
    .object({
      access_token: z.string(),
      refresh_token: z.string()
    })
    .optional(),
  two_factor_required: z.boolean().optional()
});

/**
 * Register response schema
 */
export const RegisterResponseSchema = z.object({
  success: z.boolean(),
  user: z
    .object({
      id: z.string().uuid(),
      username: z.string()
    })
    .optional(),
  tokens: z
    .object({
      access_token: z.string(),
      refresh_token: z.string()
    })
    .optional()
});

/**
 * Refresh token response schema
 */
export const RefreshTokenResponseSchema = z.object({
  success: z.boolean(),
  tokens: z
    .object({
      access_token: z.string(),
      refresh_token: z.string()
    })
    .optional()
});

/**
 * Sync response schema
 */
export const SyncResponseSchema = z.object({
  success: z.boolean(),
  server_time: z.string().datetime(),
  changes: z
    .object({
      tasks: z.array(z.unknown()).optional(),
      lists: z.array(z.unknown()).optional(),
      notes: z.array(z.unknown()).optional(),
      folders: z.array(z.unknown()).optional()
    })
    .optional(),
  conflicts: z
    .array(
      z.object({
        entity_id: z.string(),
        server_version: z.unknown(),
        local_version: z.unknown()
      })
    )
    .optional()
});

// Export inferred types
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
export type SyncMeta = z.infer<typeof SyncMetaSchema>;
export type ApiMeta = z.infer<typeof ApiMetaSchema>;
export type ApiResponse<T = unknown> = Omit<z.infer<typeof ApiResponseSchema>, 'data'> & {
  data?: T;
};
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;
export type RefreshTokenResponse = z.infer<typeof RefreshTokenResponseSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
