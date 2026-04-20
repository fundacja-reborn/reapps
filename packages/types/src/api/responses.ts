// Generic API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiMeta {
  pagination?: PaginationMeta;
  sync?: SyncMeta;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface SyncMeta {
  server_time: string;
  sync_token?: string;
  has_more?: boolean;
}

// Auth responses
export interface LoginResponse {
  success: boolean;
  user?: {
    id: string;
    username: string;
    encrypted_master_key?: string;
    master_key_salt?: string;
    encrypted_2fa_secret?: string;
  };
  tokens?: {
    access_token: string;
    refresh_token: string;
  };
  two_factor_required?: boolean;
}

export interface RegisterResponse {
  success: boolean;
  user?: {
    id: string;
    username: string;
  };
  tokens?: {
    access_token: string;
    refresh_token: string;
  };
}

export interface RefreshTokenResponse {
  success: boolean;
  tokens?: {
    access_token: string;
    refresh_token: string;
  };
}

// Sync response
export interface SyncResponse {
  success: boolean;
  server_time: string;
  changes?: {
    tasks?: Array<unknown>;
    lists?: Array<unknown>;
    notes?: Array<unknown>;
    folders?: Array<unknown>;
  };
  conflicts?: Array<{
    entity_id: string;
    server_version: unknown;
    local_version: unknown;
  }>;
}
