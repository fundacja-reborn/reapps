import { z } from 'zod';

/**
 * Schema for user
 */
export const UserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(50),
  settings_encrypted: z.string().optional(),
  master_key_salt: z.string().optional(),
  auth_key_salt: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_login_at: z.string().datetime().optional()
});

/**
 * Schema for user settings
 */
export const UserSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  language: z.enum(['en', 'pl']),
  preferred_date_format: z.string(),
  preferred_time_format: z.enum(['12h', '24h']),
  notifications_enabled: z.boolean()
});

/**
 * Schema for user profile
 */
export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(50),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  preferred_language: z.string().optional(),
  preferred_date_format: z.string().optional()
});

/**
 * Schema for user credentials
 */
export const UserCredentialsSchema = z.object({
  id: z.string().uuid(),
  refreshToken: z.string(),
  encrypted_master_key: z.string(),
  master_key_salt: z.string(),
  user_profile: UserProfileSchema
});

/**
 * Schema for login API response
 */
export const LoginApiResponseSchema = z.object({
  user: z.object({
    encrypted_master_key: z.string().optional(),
    master_key_salt: z.string().optional(),
    encrypted_2fa_secret: z.string().optional()
  }).optional(),
  data: z.object({
    id: z.string().uuid(),
    username: z.string(),
    created_at: z.string().datetime().optional(),
    updated_at: z.string().datetime().optional(),
    preferredLanguage: z.string().optional(),
    preferred_language: z.string().optional(),
    preferred_date_format: z.string().optional(),
    is_2fa_enabled: z.boolean().optional()
  }).optional(),
  refreshToken: z.string().optional(),
  success: z.boolean().optional(),
  twoFactorRequired: z.boolean().optional(),
  userId: z.string().uuid().optional(),
  message: z.string().optional()
});

// Export inferred types
export type User = z.infer<typeof UserSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type UserCredentials = z.infer<typeof UserCredentialsSchema>;
export type LoginApiResponse = z.infer<typeof LoginApiResponseSchema>;
