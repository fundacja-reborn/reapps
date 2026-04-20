import { ApiClient } from '../core/client';
import type { ApiResponse, EntityType } from '../types';

/**
 * Sync data for an entity type
 */
export interface SyncData {
  created: Array<{ id: string; data: unknown }>;
  updated: Array<{ id: string; data: unknown }>;
  deleted: string[];
}

/**
 * Sync response
 */
export interface SyncResponse {
  [entityType: string]: {
    created: Array<{ localId: string; serverId: string }>;
    updated: string[];
    deleted: string[];
    conflicts: Array<{
      id: string;
      localData: unknown;
      serverData: unknown;
    }>;
  };
}

/**
 * Sync status
 */
export interface SyncStatusResponse {
  lastSync: string;
  pendingChanges: {
    [entityType: string]: number;
  };
  conflicts: {
    [entityType: string]: number;
  };
}

/**
 * Conflict resolution strategy
 */
export type ConflictResolution = 'local' | 'server' | 'merge';

/**
 * Sync endpoints
 */
export class SyncEndpoints {
  constructor(private client: ApiClient) {}

  /**
   * Get sync status
   */
  async getStatus(): Promise<ApiResponse<SyncStatusResponse>> {
    return this.client.get<SyncStatusResponse>('/sync/status');
  }

  /**
   * Sync all data
   */
  async syncAll(data: {
    [entityType: string]: SyncData;
  }): Promise<ApiResponse<SyncResponse>> {
    return this.client.post<SyncResponse>('/sync', data);
  }

  /**
   * Sync specific entity type
   */
  async syncEntityType(
    entityType: EntityType,
    data: SyncData
  ): Promise<ApiResponse<SyncResponse>> {
    return this.client.post<SyncResponse>(`/sync/${entityType}`, data);
  }

  /**
   * Get changes since last sync
   */
  async getChanges(since?: string): Promise<ApiResponse<{
    [entityType: string]: {
      created: unknown[];
      updated: unknown[];
      deleted: string[];
    };
  }>> {
    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.client.get(`/sync/changes${params}`);
  }

  /**
   * Resolve conflict
   */
  async resolveConflict(
    entityType: EntityType,
    entityId: string,
    resolution: ConflictResolution,
    mergedData?: unknown
  ): Promise<ApiResponse<unknown>> {
    return this.client.post(`/sync/conflicts/resolve`, {
      entityType,
      entityId,
      resolution,
      mergedData
    });
  }

  /**
   * Get conflicts
   */
  async getConflicts(entityType?: EntityType): Promise<ApiResponse<Array<{
    entityType: string;
    entityId: string;
    localData: unknown;
    serverData: unknown;
    createdAt: string;
  }>>> {
    const params = entityType ? `?type=${entityType}` : '';
    return this.client.get(`/sync/conflicts${params}`);
  }

  /**
   * Force push local data (overwrites server)
   */
  async forcePush(entityType: EntityType, entityId: string): Promise<ApiResponse<void>> {
    return this.client.post<void>(`/sync/force-push`, {
      entityType,
      entityId
    });
  }

  /**
   * Force pull server data (overwrites local)
   */
  async forcePull(entityType: EntityType, entityId: string): Promise<ApiResponse<unknown>> {
    return this.client.post(`/sync/force-pull`, {
      entityType,
      entityId
    });
  }

  /**
   * Reset sync state
   */
  async reset(entityType?: EntityType): Promise<ApiResponse<void>> {
    const params = entityType ? `?type=${entityType}` : '';
    return this.client.post<void>(`/sync/reset${params}`);
  }

  /**
   * Get sync log
   */
  async getLog(options?: {
    entityType?: EntityType;
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<Array<{
    id: string;
    entityType: string;
    entityId: string;
    operation: 'create' | 'update' | 'delete';
    status: 'success' | 'failed' | 'conflict';
    timestamp: string;
    error?: string;
  }>>> {
    const params = new URLSearchParams();
    if (options?.entityType) params.append('type', options.entityType);
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());
    
    const queryString = params.toString();
    return this.client.get(`/sync/log${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Sync offline queue
   */
  async syncOfflineQueue(): Promise<ApiResponse<{
    processed: number;
    failed: number;
    remaining: number;
  }>> {
    return this.client.post('/sync/offline-queue');
  }

  /**
   * Get sync metrics
   */
  async getMetrics(): Promise<ApiResponse<{
    totalSyncs: number;
    successfulSyncs: number;
    failedSyncs: number;
    averageSyncTime: number;
    lastSyncDuration: number;
    dataTransferred: {
      uploaded: number;
      downloaded: number;
    };
  }>> {
    return this.client.get('/sync/metrics');
  }
}
