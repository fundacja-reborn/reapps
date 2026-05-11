/**
 * Core types for API client
 */

/**
 * Standard API response format
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  status?: number;
}

/**
 * API error response
 */
export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Request configuration
 */
export interface RequestConfig extends RequestInit {
  skipAuth?: boolean;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
  cancelToken?: AbortController;
  onUploadProgress?: (progress: ProgressEvent) => void;
  onDownloadProgress?: (progress: ProgressEvent) => void;
  encrypt?: boolean;
  decrypt?: boolean;
}

/**
 * Offline queue item
 */
export interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  data?: unknown;
  headers?: Record<string, string>;
  timestamp: number;
  retries: number;
  entityType?: 'task' | 'task_list' | 'sub_task' | 'note' | 'folder' | 'tag';
  entityId?: string;
  operationType?: 'create' | 'update' | 'delete';
}

/**
 * Outcome of an `onUnauthorized` refresh attempt. Discriminates three
 * semantically distinct cases that the legacy `boolean` return type collapsed:
 *
 * - `'refreshed'` — access token was rotated; ApiClient retries the original
 *   request once with the new Bearer header.
 * - `'session-expired'` — `/auth/refresh` returned a definitive 401/403 (or
 *   `success:false`). The refresh token is gone; the user must re-authenticate.
 *   ApiClient surfaces the original 401 AND invokes `onSessionExpired` so the
 *   app can show its re-auth UI (e.g. the session-expired banner).
 * - `'transient'` — refresh failed for a non-definitive reason (5xx from nginx
 *   during a deploy, network error, timeout). The session is probably still
 *   valid; ApiClient surfaces the original 401 as a regular sync error and
 *   does NOT invoke `onSessionExpired`. Callers should retry later.
 */
export type UnauthorizedResult = 'refreshed' | 'session-expired' | 'transient';

/**
 * API client configuration
 */
export interface ApiClientConfig {
  baseUrl?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
  onRequest?: (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
  onResponse?: <T>(response: ApiResponse<T>) => ApiResponse<T> | Promise<ApiResponse<T>>;
  onError?: (error: ApiError) => void | Promise<void>;
  /**
   * Called when a non-auth endpoint returns 401. Implementations should
   * single-flight refresh the access token (typically `authFetch.refresh()`)
   * and return:
   * - `'refreshed'` when a new token is available → client retries once,
   * - `'session-expired'` when refresh failed definitively → client surfaces
   *   the 401 AND invokes `onSessionExpired` (so the app can prompt re-auth),
   * - `'transient'` when refresh failed transiently → client surfaces the 401
   *   without flagging the session as expired.
   *
   * Throwing from this callback is treated as `'transient'` (defensive default).
   */
  onUnauthorized?: () => Promise<UnauthorizedResult>;
  /**
   * Called when `onUnauthorized` resolves to `'session-expired'`. Use to
   * surface the re-auth UI (e.g. flip a `sessionExpired` store that drives the
   * session-expired banner). Symmetric to `createAuthFetch`'s
   * `onSessionExpired` so both refresh paths (direct `authFetch(...)` wrapper
   * and `ApiClient` on 401) share the same UX trigger.
   */
  onSessionExpired?: () => void;
}

/**
 * Progress event for upload/download tracking
 */
export interface ProgressEvent {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Request interceptor
 */
export interface RequestInterceptor {
  onRequest(config: RequestConfig): RequestConfig | Promise<RequestConfig>;
}

/**
 * Response interceptor
 */
export interface ResponseInterceptor {
  onResponse<T>(response: ApiResponse<T>): ApiResponse<T> | Promise<ApiResponse<T>>;
  onError(error: ApiError): void | Promise<void>;
}

/**
 * Entity types that can be synced
 */
export type EntityType = 'task' | 'task_list' | 'sub_task' | 'note' | 'folder' | 'tag';

/**
 * Operation types
 */
export type OperationType = 'create' | 'update' | 'delete';

/**
 * Sync status for offline-first architecture
 */
export interface SyncStatus {
  lastSync?: string;
  pending: number;
  failed: number;
  syncing: boolean;
}

/**
 * ID mapping for local/server ID resolution
 */
export interface IdMapping {
  localId: string;
  serverId: string;
  entityType: EntityType;
  createdAt: string;
}
