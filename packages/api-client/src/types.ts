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
