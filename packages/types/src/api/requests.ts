// Generic API Request types
export interface ApiRequest<T = unknown> {
  data: T;
  headers?: Record<string, string>;
}

// Pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

// Sync request
export interface SyncRequest {
  last_sync_at?: string;
  device_id: string;
  changes: {
    tasks?: Array<unknown>;
    lists?: Array<unknown>;
    notes?: Array<unknown>;
    folders?: Array<unknown>;
  };
}

// Auth requests
export interface LoginRequest {
  username: string;
  password: string;
  device_name?: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  device_name?: string;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}
