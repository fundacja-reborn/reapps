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
  refresh_token: z.string().max(2048)
});

/**
 * Two-factor verification request schema.
 * `challengeToken` is the short-lived single-use token issued by /login after
 * the password step (audit 012 S4) - a raw userId is no longer accepted.
 */
export const TwoFactorVerifyRequestSchema = z.object({
  challengeToken: z.string().max(2048),
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
  website: z.string().optional(), // Honeypot - must be empty
  _t: z.number().optional(), // Form load timestamp (ms) for timing check
  powChallenge: z.string().optional(), // Signed PoW challenge (JSON)
  powSolution: z.number().optional(), // PoW nonce solution
  // Default task list - created atomically with user (encrypted client-side)
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

/**
 * E2E synced user settings bundle (PUT body for /api/settings/{shared|app}).
 * `settings_encrypted` carries an AES-GCM ciphertext in `iv:ciphertext` base64
 * format - strict format validation runs in the Encryption Guard layer.
 */
export const SettingsBundleBodySchema = z.object({
  settings_encrypted: z.string().min(20).max(1_000_000),
  updated_at: z.string().datetime()
});
export type SettingsBundleBody = z.infer<typeof SettingsBundleBodySchema>;

/**
 * Push schedule request - client posts the list of pending task reminders.
 *
 * Idempotent replace-all per (subscription, user): the server deletes all
 * unsent schedules for the subscription and re-inserts the current list. This
 * lets the client re-sync after any task change without tracking diffs.
 *
 * `task_id` is a plaintext FK (server already knows task IDs).
 * `fire_at` is bucketed to 5-minute marks client-side - server precision is
 * 5 min, which is the documented ZK trade-off (see security-overview.md §7).
 *
 * Cap of 500 entries: gracefully bounds the request size; a typical user has
 * far fewer due reminders in any 7-day window.
 */
export const PushScheduleItemSchema = z.object({
  task_id: z.string().uuid(),
  fire_at: z.string().datetime()
});

export const PushScheduleBodySchema = z.object({
  endpoint: z.string().url().max(2048),
  items: z.array(PushScheduleItemSchema).max(500)
});
export type PushScheduleBody = z.infer<typeof PushScheduleBodySchema>;
