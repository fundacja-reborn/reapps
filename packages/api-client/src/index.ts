/**
 * @reborn/api-client - Universal API client for Reborn apps
 */

// Import for internal use
import { ApiClient } from './core/client';
import { AuthEndpoints } from './endpoints/auth';
import { TaskEndpoints } from './endpoints/tasks';
import { TaskListEndpoints } from './endpoints/tasklists';
import { SyncEndpoints } from './endpoints/sync';
import { NoteEndpoints, FolderEndpoints, TagEndpoints } from './endpoints/notes';
import type { ApiClientConfig } from './types';

// Core exports
export { ApiClient, apiClient } from './core/client';

// Type exports
export * from './types';

// Interceptor exports
export { AuthInterceptor } from './interceptors/auth';
export { EncryptionInterceptor } from './interceptors/encryption';

// Utility exports
export { OfflineQueue } from './utils/offline-queue';
export { IdResolver } from './utils/id-resolver';
export { RetryManager } from './utils/retry-manager';

// Endpoint exports
export { AuthEndpoints } from './endpoints/auth';
export { TaskEndpoints } from './endpoints/tasks';
export { TaskListEndpoints } from './endpoints/tasklists';
export { SyncEndpoints } from './endpoints/sync';
export { NoteEndpoints, FolderEndpoints, TagEndpoints } from './endpoints/notes';

// Re-export types from endpoints
export type { 
  LoginCredentials, 
  RegisterData, 
  UserProfile, 
  AuthResponse 
} from './endpoints/auth';

export type { 
  TaskQueryParams 
} from './endpoints/tasks';

export type { 
  NoteQueryParams 
} from './endpoints/notes';

export type {
  SyncData,
  SyncResponse,
  SyncStatusResponse,
  ConflictResolution
} from './endpoints/sync';

/**
 * Create configured API client with all endpoints
 */
export function createApiClient(config?: ApiClientConfig) {
  const client = new ApiClient(config);
  
  return {
    client,
    auth: new AuthEndpoints(client),
    tasks: new TaskEndpoints(client),
    taskLists: new TaskListEndpoints(client),
    sync: new SyncEndpoints(client),
    notes: new NoteEndpoints(client),
    folders: new FolderEndpoints(client),
    tags: new TagEndpoints(client)
  };
}

/**
 * Default configured API instance
 */
export const api = createApiClient();
