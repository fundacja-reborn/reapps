import { ApiClient } from '../core/client';
import type { ApiResponse } from '../types';
import type { EncryptedTaskList } from '@reborn/types';

/**
 * Task list endpoints
 */
export class TaskListEndpoints {
  constructor(private client: ApiClient) {}

  /**
   * Get all task lists
   */
  async getAll(): Promise<ApiResponse<EncryptedTaskList[]>> {
    return this.client.get<EncryptedTaskList[]>('/tasklists');
  }

  /**
   * Get task list by ID
   */
  async getById(id: string): Promise<ApiResponse<EncryptedTaskList>> {
    // Resolve local ID to server ID
    const serverId = await this.client.resolveId(id, 'task_list');
    return this.client.get<EncryptedTaskList>(`/tasklists/${serverId}`);
  }

  /**
   * Create new task list
   */
  async create(taskList: EncryptedTaskList): Promise<ApiResponse<EncryptedTaskList>> {
    const response = await this.client.post<EncryptedTaskList>('/tasklists', taskList);
    
    // Save ID mapping if server assigned different ID
    if (response.success && response.data && response.data.id !== taskList.id) {
      await this.client.saveIdMapping({
        localId: taskList.id,
        serverId: response.data.id,
        entityType: 'task_list',
        createdAt: new Date().toISOString()
      });
    }
    
    return response;
  }

  /**
   * Update task list
   */
  async update(id: string, updates: Partial<EncryptedTaskList>): Promise<ApiResponse<EncryptedTaskList>> {
    // Resolve local ID to server ID
    const serverId = await this.client.resolveId(id, 'task_list');
    return this.client.put<EncryptedTaskList>(`/tasklists/${serverId}`, updates);
  }

  /**
   * Delete task list
   * 
   * Note: This endpoint is used only by the sync service.
   * Client applications should use listDeleteOps from @reborn/storage
   * and queue operations via offlineOperationsStore.
   */
  async delete(id: string, options?: { deleteMode?: 'soft' | 'with-tasks' | 'move-tasks', targetListId?: string }): Promise<ApiResponse<void>> {
    // Resolve local ID to server ID
    const serverId = await this.client.resolveId(id, 'task_list');
    
    // Include delete options in body if provided
    const body = options ? {
      deleteMode: options.deleteMode,
      targetListId: options.targetListId
    } : undefined;
    
    return this.client.delete<void>(`/tasklists/${serverId}`, body);
  }

  /**
   * Set default task list
   */
  async setDefault(id: string): Promise<ApiResponse<EncryptedTaskList>> {
    const serverId = await this.client.resolveId(id, 'task_list');
    return this.client.post<EncryptedTaskList>(`/tasklists/${serverId}/set-default`);
  }

  /**
   * Get task count for list
   */
  async getTaskCount(id: string): Promise<ApiResponse<{ count: number; completed: number }>> {
    const serverId = await this.client.resolveId(id, 'task_list');
    return this.client.get<{ count: number; completed: number }>(`/tasklists/${serverId}/count`);
  }

  /**
   * Reorder task lists
   */
  async reorder(listIds: string[]): Promise<ApiResponse<EncryptedTaskList[]>> {
    const serverListIds = await Promise.all(
      listIds.map(id => this.client.resolveId(id, 'task_list'))
    );
    
    return this.client.post<EncryptedTaskList[]>('/tasklists/reorder', {
      listIds: serverListIds
    });
  }

  /**
   * Duplicate task list (with all tasks)
   */
  async duplicate(id: string, name?: string): Promise<ApiResponse<EncryptedTaskList>> {
    const serverId = await this.client.resolveId(id, 'task_list');
    const response = await this.client.post<EncryptedTaskList>(
      `/tasklists/${serverId}/duplicate`,
      { name }
    );
    
    // Save ID mapping for duplicated list
    if (response.success && response.data) {
      await this.client.saveIdMapping({
        localId: crypto.randomUUID(), // Generate new local ID for duplicate
        serverId: response.data.id,
        entityType: 'task_list',
        createdAt: new Date().toISOString()
      });
    }
    
    return response;
  }

  /**
   * Archive task list
   */
  async archive(id: string): Promise<ApiResponse<EncryptedTaskList>> {
    const serverId = await this.client.resolveId(id, 'task_list');
    return this.client.post<EncryptedTaskList>(`/tasklists/${serverId}/archive`);
  }

  /**
   * Unarchive task list
   */
  async unarchive(id: string): Promise<ApiResponse<EncryptedTaskList>> {
    const serverId = await this.client.resolveId(id, 'task_list');
    return this.client.post<EncryptedTaskList>(`/tasklists/${serverId}/unarchive`);
  }

  /**
   * Get archived task lists
   */
  async getArchived(): Promise<ApiResponse<EncryptedTaskList[]>> {
    return this.client.get<EncryptedTaskList[]>('/tasklists/archived');
  }

}
