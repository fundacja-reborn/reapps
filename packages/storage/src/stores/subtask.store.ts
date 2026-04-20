import { IndexedDBStore } from '../core/store';
import type { SubtaskStoredLocal } from '@reborn/types';

/**
 * Subtask store for managing task subtasks.
 * Uses SubtaskStoredLocal which extends SubtaskEncrypted with local is_completed shadow index.
 */
export const subtaskStore = new IndexedDBStore<SubtaskStoredLocal>({
  storeName: 'subtasks',
  indexes: [
    { name: 'task_id', keyPath: 'task_id' },
    { name: 'is_completed', keyPath: 'is_completed' },
    { name: 'position', keyPath: 'position' }
  ]
});

/**
 * Helper queries for subtasks
 */
export const subtaskQueries = {
  /**
   * Get all active subtasks for a task (excluding deleted)
   */
  byTask: async (taskId: string): Promise<SubtaskStoredLocal[]> => {
    const subtasks = await subtaskStore.query('task_id', taskId);
    const activeSubtasks = subtasks.filter(st => !st.deleted_at);
    return activeSubtasks.sort((a, b) => a.position - b.position);
  },

  /**
   * Count completed subtasks for a task (excluding deleted)
   */
  countCompleted: async (taskId: string): Promise<number> => {
    const subtasks = await subtaskQueries.byTask(taskId);
    return subtasks.filter(st => st.is_completed === 1).length;
  },

  /**
   * Get task completion percentage
   */
  getTaskProgress: async (taskId: string): Promise<number> => {
    const subtasks = await subtaskQueries.byTask(taskId);
    if (subtasks.length === 0) return 0;

    const completed = subtasks.filter(st => st.is_completed === 1).length;
    return Math.round((completed / subtasks.length) * 100);
  }
};


