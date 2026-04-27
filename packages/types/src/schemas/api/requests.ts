import { z } from 'zod';

/**
 * Generic API request schema
 */
export const ApiRequestSchema = z.object({
  data: z.unknown(),
  headers: z.record(z.string(), z.string()).optional()
});

/**
 * Pagination parameters schema
 */
export const PaginationParamsSchema = z.object({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional()
});

/**
 * Sync request schema
 */
export const SyncRequestSchema = z.object({
  last_sync_at: z.string().datetime().optional(),
  device_id: z.string(),
  changes: z.object({
    tasks: z.array(z.unknown()).optional(),
    lists: z.array(z.unknown()).optional(),
    notes: z.array(z.unknown()).optional(),
    folders: z.array(z.unknown()).optional()
  })
});

/**
 * Login request schema
 */
export const LoginRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  device_name: z.string().optional()
});

/**
 * Register request schema
 */
export const RegisterRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  device_name: z.string().optional(),
  preferred_language: z.string().optional()
});

/**
 * Refresh token request schema
 */
export const RefreshTokenRequestSchema = z.object({
  refresh_token: z.string()
});

/**
 * Two-factor verification request schema
 */
export const TwoFactorVerifyRequestSchema = z.object({
  userId: z.string(),
  code: z.string().length(6)
});

/**
 * E2E Register request schema
 * For Zero Knowledge architecture where password is hashed client-side
 */
export const E2ERegisterRequestSchema = z.object({
  username: z.string().min(3).max(50),
  passwordHash: z.string(), // Pre-hashed on client side
  encryptedMasterKey: z.string(),
  masterKeySalt: z.string(),
  device_name: z.string().optional(),
  preferred_language: z.string().optional(),
  // Bot protection fields
  website: z.string().optional(), // Honeypot — must be empty
  _t: z.number().optional(), // Form load timestamp (ms) for timing check
  powChallenge: z.string().optional(), // Signed PoW challenge (JSON)
  powSolution: z.number().optional(), // PoW nonce solution
  // Default task list — created atomically with user (encrypted client-side)
  defaultTaskList: z.object({
    id: z.string().uuid(),
    name_encrypted: z.string().min(1),
    is_default: z.literal(true)
  }).optional()
});

// Export inferred types
export type ApiRequest<T = unknown> = z.infer<typeof ApiRequestSchema> & { data: T };
export type PaginationParams = z.infer<typeof PaginationParamsSchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
export type TwoFactorVerifyRequest = z.infer<typeof TwoFactorVerifyRequestSchema>;
export type E2ERegisterRequest = z.infer<typeof E2ERegisterRequestSchema>;

/**
 * Web Push subscription request schema
 */
export const WebPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512)
  }),
  device_info_encrypted: z.string().max(4096).optional()
});
export type WebPushSubscription = z.infer<typeof WebPushSubscriptionSchema>;
