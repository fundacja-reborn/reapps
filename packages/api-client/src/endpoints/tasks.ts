import { ApiClient } from '../core/client';
import type { ApiResponse } from '../types';
import type { EncryptedTask, EncryptedSubTask } from '@reborn/types';

/**
 * Task query parameters
 */
export interface TaskQueryParams {
  listId?: string;
  completed?: boolean;
  search?: string;
  orderBy?: 'created_at' | 'updated_at' | 'due_date' | 'order';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Task endpoints
 */
export class TaskEndpoints {
  constructor(private client: ApiClient) {}

  /**
   * Get all tasks
   */
  async getAll(params?: TaskQueryParams): Promise<ApiResponse<EncryptedTask[]>> {
    const queryString = this.buildQueryString(params);
    return this.client.get<EncryptedTask[]>(`/tasks${queryString}`);
  }

  /**
   * Get task by ID
   */
  async getById(id: string): Promise<ApiResponse<EncryptedTask>> {
    // Resolve local ID to server ID
    const serverId = await this.client.resolveId(id, 'task');
    return this.client.get<EncryptedTask>(`/tasks/${serverId}`);
  }

  /**
   * Create new task
   */
  async create(task: EncryptedTask): Promise<ApiResponse<EncryptedTask>> {
    const response = await this.client.post<EncryptedTask>('/tasks', task);
    
    // Save ID mapping if server assigned different ID
    if (response.success && response.data && response.data.id !== task.id) {
      await this.client.saveIdMapping({
        localId: task.id,
        serverId: response.data.id,
        entityType: 'task',
        createdAt: new Date().toISOString()
      });
    }
    
    return response;
  }

  /**
   * Update task
   */
  async update(id: string, updates: Partial<EncryptedTask>): Promise<ApiResponse<EncryptedTask>> {
    // Resolve local ID to server ID
    const serverId = await this.client.resolveId(id, 'task');
    return this.client.put<EncryptedTask>(`/tasks/${serverId}`, updates);
  }

  /**
   * Delete task
   */
  async delete(id: string): Promise<ApiResponse<void>> {
    // Resolve local ID to server ID
    const serverId = await this.client.resolveId(id, 'task');
    return this.client.delete<void>(`/tasks/${serverId}`);
  }

  /**
   * Batch create tasks
   */
  async batchCreate(tasks: EncryptedTask[]): Promise<ApiResponse<EncryptedTask[]>> {
    const response = await this.client.post<EncryptedTask[]>('/tasks/batch', { tasks });
    
    // Save ID mappings
    if (response.success && response.data) {
      const mappings = response.data
        .filter((task, index) => task.id !== tasks[index].id)
        .map((task, index) => ({
          localId: tasks[index].id,
          serverId: task.id,
          entityType: 'task' as const,
          createdAt: new Date().toISOString()
        }));
      
      if (mappings.length > 0) {
        await Promise.all(mappings.map(m => this.client.saveIdMapping(m)));
      }
    }
    
    return response;
  }

  /**
   * Batch update tasks
   */
  async batchUpdate(updates: Array<{ id: string; updates: Partial<EncryptedTask> }>): Promise<ApiResponse<EncryptedTask[]>> {
    // Resolve IDs
    const resolvedUpdates = await Promise.all(
      updates.map(async ({ id, updates }) => ({
        id: await this.client.resolveId(id, 'task'),
        updates
      }))
    );
    
    return this.client.put<EncryptedTask[]>('/tasks/batch', { updates: resolvedUpdates });
  }

  /**
   * Batch delete tasks
   */
  async batchDelete(ids: string[]): Promise<ApiResponse<void>> {
    // Resolve IDs
    const serverIds = await Promise.all(
      ids.map(id => this.client.resolveId(id, 'task'))
    );
    
    return this.client.delete<void>('/tasks/batch', {
      body: JSON.stringify({ ids: serverIds })
    });
  }

  /**
   * Get task subtasks
   */
  async getSubtasks(taskId: string): Promise<ApiResponse<EncryptedSubTask[]>> {
    const serverId = await this.client.resolveId(taskId, 'task');
    return this.client.get<EncryptedSubTask[]>(`/tasks/${serverId}/subtasks`);
  }

  /**
   * Create subtask
   */
  async createSubtask(taskId: string, subtask: EncryptedSubTask): Promise<ApiResponse<EncryptedSubTask>> {
    const serverTaskId = await this.client.resolveId(taskId, 'task');
    const response = await this.client.post<EncryptedSubTask>(
      `/tasks/${serverTaskId}/subtasks`,
      subtask
    );
    
    // Save ID mapping if server assigned different ID
    if (response.success && response.data && response.data.id !== subtask.id) {
      await this.client.saveIdMapping({
        localId: subtask.id,
        serverId: response.data.id,
        entityType: 'sub_task',
        createdAt: new Date().toISOString()
      });
    }
    
    return response;
  }

  /**
   * Update subtask
   */
  async updateSubtask(
    taskId: string,
    subtaskId: string,
    updates: Partial<EncryptedSubTask>
  ): Promise<ApiResponse<EncryptedSubTask>> {
    const serverTaskId = await this.client.resolveId(taskId, 'task');
    const serverSubtaskId = await this.client.resolveId(subtaskId, 'sub_task');
    
    return this.client.put<EncryptedSubTask>(
      `/tasks/${serverTaskId}/subtasks/${serverSubtaskId}`,
      updates
    );
  }

  /**
   * Delete subtask
   */
  async deleteSubtask(taskId: string, subtaskId: string): Promise<ApiResponse<void>> {
    const serverTaskId = await this.client.resolveId(taskId, 'task');
    const serverSubtaskId = await this.client.resolveId(subtaskId, 'sub_task');
    
    return this.client.delete<void>(
      `/tasks/${serverTaskId}/subtasks/${serverSubtaskId}`
    );
  }

  /**
   * Get all subtasks (across all tasks)
   */
  async getAllSubtasks(): Promise<ApiResponse<EncryptedSubTask[]>> {
    return this.client.get<EncryptedSubTask[]>('/subtasks');
  }

  /**
   * Move task to another list
   */
  async moveToList(taskId: string, listId: string): Promise<ApiResponse<EncryptedTask>> {
    const serverTaskId = await this.client.resolveId(taskId, 'task');
    const serverListId = await this.client.resolveId(listId, 'task_list');
    
    return this.client.patch<EncryptedTask>(
      `/tasks/${serverTaskId}/move`,
      { listId: serverListId }
    );
  }

  /**
   * Reorder tasks
   */
  async reorder(
    listId: string,
    taskIds: string[]
  ): Promise<ApiResponse<EncryptedTask[]>> {
    const serverListId = await this.client.resolveId(listId, 'task_list');
    const serverTaskIds = await Promise.all(
      taskIds.map(id => this.client.resolveId(id, 'task'))
    );
    
    return this.client.post<EncryptedTask[]>('/tasks/reorder', {
      listId: serverListId,
      taskIds: serverTaskIds
    });
  }

  /**
   * Build query string from parameters
   */
  private buildQueryString(params?: TaskQueryParams): string {
    if (!params) return '';
    
    const searchParams = new URLSearchParams();
    
    if (params.listId) searchParams.append('listId', params.listId);
    if (params.completed !== undefined) searchParams.append('completed', params.completed.toString());
    if (params.search) searchParams.append('search', params.search);
    if (params.orderBy) searchParams.append('orderBy', params.orderBy);
    if (params.order) searchParams.append('order', params.order);
    if (params.limit) searchParams.append('limit', params.limit.toString());
    if (params.offset) searchParams.append('offset', params.offset.toString());
    
    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }
}
