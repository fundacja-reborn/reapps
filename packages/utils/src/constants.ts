/**
 * Common constants used across the application
 */

// Storage keys
export const STORAGE_KEYS = {
  USER_SETTINGS: 'user_settings',
  AUTH_TOKEN: 'auth_token',
  REFRESH_TOKEN: 'refresh_token',
  DEVICE_ID: 'device_id',
  LAST_SYNC: 'last_sync',
  ENCRYPTION_KEY: 'encryption_key',
  MASTER_KEY_HASH: 'master_key_hash'
} as const;

// API endpoints
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    VERIFY_2FA: '/auth/verify-2fa'
  },
  TASKS: {
    LIST: '/tasks',
    CREATE: '/tasks',
    UPDATE: '/tasks/:id',
    DELETE: '/tasks/:id',
    SYNC: '/tasks/sync'
  },
  LISTS: {
    LIST: '/lists',
    CREATE: '/lists',
    UPDATE: '/lists/:id',
    DELETE: '/lists/:id'
  },
  NOTES: {
    LIST: '/notes',
    CREATE: '/notes',
    UPDATE: '/notes/:id',
    DELETE: '/notes/:id',
    SYNC: '/notes/sync'
  }
} as const;

// Time constants
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000
} as const;

// Sync intervals
export const SYNC_INTERVALS = {
  AUTO_SYNC: 30 * TIME.SECOND, // 30 seconds
  RETRY_DELAY: 5 * TIME.SECOND, // 5 seconds
  MAX_RETRY_DELAY: 5 * TIME.MINUTE, // 5 minutes
  OFFLINE_CHECK: 10 * TIME.SECOND // 10 seconds
} as const;

// Limits
export const LIMITS = {
  MAX_TITLE_LENGTH: 500,
  MAX_DESCRIPTION_LENGTH: 5000,
  MAX_NOTE_LENGTH: 50000,
  MAX_TAG_LENGTH: 50,
  MAX_TAGS_PER_NOTE: 20,
  MAX_SUBTASKS: 50,
  MAX_LISTS: 100,
  MAX_FOLDERS_DEPTH: 5
} as const;

// Crypto constants
export const CRYPTO = {
  SALT_LENGTH: 16,
  IV_LENGTH: 12,
  KEY_LENGTH: 32,
  PBKDF2_ITERATIONS: 100000,
  ALGORITHM: 'AES-GCM'
} as const;

// Default values
export const DEFAULTS = {
  THEME: 'system',
  LANGUAGE: 'en',
  DATE_FORMAT: 'yyyy-MM-dd',
  TIME_FORMAT: '24h',
  PAGE_SIZE: 50,
  DEBOUNCE_DELAY: 300
} as const;

// Error codes
export const ERROR_CODES = {
  // Auth errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // Storage errors
  STORAGE_ERROR: 'STORAGE_ERROR',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  
  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  
  // Sync errors
  SYNC_CONFLICT: 'SYNC_CONFLICT',
  SYNC_ERROR: 'SYNC_ERROR',
  
  // Crypto errors
  ENCRYPTION_ERROR: 'ENCRYPTION_ERROR',
  DECRYPTION_ERROR: 'DECRYPTION_ERROR',
  INVALID_KEY: 'INVALID_KEY'
} as const;
