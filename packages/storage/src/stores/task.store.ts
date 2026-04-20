import { IndexedDBStore } from '../core/store';
import type { TaskStoredLocal, TaskEncryptedBooleans, BooleanInt } from '@reborn/types';

/**
 * Custom transformer for tasks that handles conversion between TaskEncryptedBooleans and TaskStoredLocal.
 * TaskStoredLocal has BooleanInt shadow indexes (is_completed, is_starred, is_recurring)
 * extracted from decrypted metadata — these are local-only, never sent to server.
 */
const taskTransformer = {
  toStorage: (item: TaskEncryptedBooleans): TaskStoredLocal => {
    const result: any = { ...item };

    // Convert boolean fields to BooleanInt for IndexedDB indexing
    result.is_completed = item.is_completed ? 1 : 0;
    result.is_starred = item.is_starred ? 1 : 0;
    if (item.is_recurring !== undefined) {
      result.is_recurring = item.is_recurring ? 1 : 0;
    }
    result.is_template = item.is_template ? 1 : 0;

    if (result.position === undefined || result.position === null) {
      result.position = 0;
    } else {
      result.position = Number(result.position);
    }

    return result as TaskStoredLocal;
  },

  fromStorage: (item: TaskStoredLocal): TaskEncryptedBooleans => {
    const result: any = { ...item };

    // Convert BooleanInt fields to boolean
    result.is_completed = item.is_completed === 1;
    result.is_starred = item.is_starred === 1;
    if (item.is_recurring !== undefined) {
      result.is_recurring = item.is_recurring === 1;
    }
    result.is_template = item.is_template === 1;

    if (result.position === undefined || result.position === null) {
      result.position = 0;
    } else {
      result.position = Number(result.position);
    }

    return result as TaskEncryptedBooleans;
  }
};

/**
 * Task store with automatic boolean transformation.
 * Stores TaskStoredLocal (with shadow indexes), exposes TaskEncryptedBooleans (with booleans).
 */
export const taskStore = new IndexedDBStore<TaskStoredLocal, TaskEncryptedBooleans>({
  storeName: 'tasks',
  indexes: [
    { name: 'task_list_id', keyPath: 'task_list_id' },
    { name: 'is_completed', keyPath: 'is_completed' },
    { name: 'is_starred', keyPath: 'is_starred' },
    { name: 'is_recurring', keyPath: 'is_recurring' },
    { name: 'is_template', keyPath: 'is_template' },
    { name: 'parent_task_id', keyPath: 'parent_task_id' },
    { name: 'due_date', keyPath: 'due_date' },
    { name: 'created_at', keyPath: 'created_at' },
    { name: 'updated_at', keyPath: 'updated_at' },
    { name: 'position', keyPath: 'position' }
  ],
  transform: taskTransformer
});

/**
 * Helper queries for common task operations
 */
export const taskQueries = {
  /**
   * Get all tasks for a specific list
   */
  byList: (listId: string) => 
    taskStore.query('task_list_id', listId),
  
  /**
   * Get all starred tasks
   */
  starred: () => 
    taskStore.query('is_starred', 1 as BooleanInt),
  
  /**
   * Get all completed tasks
   */
  completed: () => 
    taskStore.query('is_completed', 1 as BooleanInt),
  
  /**
   * Get all active (not completed) tasks
   */
  active: async (listId?: string) => {
    const tasks = listId 
      ? await taskQueries.byList(listId)
      : await taskStore.getAll();
    return tasks.filter(t => !t.is_completed);
  },
  
  /**
   * Get all recurring tasks
   */
  recurring: () => 
    taskStore.query('is_recurring', 1 as BooleanInt),
  
  /**
   * Get all template tasks
   */
  templates: () => 
    taskStore.query('is_template', 1 as BooleanInt),
  
  /**
   * Get all instances of a template task
   */
  instancesOfTemplate: (templateId: string) => 
    taskStore.query('parent_task_id', templateId),
  
  /**
   * Get tasks due on a specific date
   */
  byDueDate: (date: string) => 
    taskStore.query('due_date', date),
  
  /**
   * Get tasks due between two dates
   */
  byDueDateRange: (startDate: string, endDate: string) => 
    taskStore.queryRange('due_date', startDate, endDate),
  
  /**
   * Get overdue tasks
   */
  overdue: async () => {
    const now = new Date().toISOString();
    const tasks = await taskStore.queryRange('due_date', '', now, { upperOpen: true });
    return tasks.filter(t => !t.is_completed);
  },
  
  /**
   * Get tasks for today
   */
  today: async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    return taskStore.queryRange(
      'due_date', 
      startOfDay.toISOString(), 
      endOfDay.toISOString()
    );
  },
  
  /**
   * Get tasks updated after a specific date (for sync)
   */
  updatedAfter: (date: string) => 
    taskStore.queryRange('updated_at', date, new Date().toISOString(), { lowerOpen: true }),
  
  /**
   * Count tasks by completion status
   */
  countByStatus: async () => {
    const completed = await taskStore.countByIndex('is_completed', 1 as BooleanInt);
    const active = await taskStore.countByIndex('is_completed', 0 as BooleanInt);
    return { completed, active, total: completed + active };
  },
  
  /**
   * Get task statistics for a list
   */
  getListStats: async (listId: string) => {
    const tasks = await taskQueries.byList(listId);
    const completed = tasks.filter(t => t.is_completed).length;
    const starred = tasks.filter(t => t.is_starred).length;
    const recurring = tasks.filter(t => t.is_recurring).length;
    
    return {
      total: tasks.length,
      completed,
      active: tasks.length - completed,
      starred,
      recurring
    };
  }
};

/**
 * Batch operations for tasks
 */
export const taskBatchOps = {
  /**
   * Mark multiple tasks as completed
   */
  markCompleted: async (taskIds: string[]) => {
    const tasks = await taskStore.getMany(taskIds);
    const updatedTasks = tasks.map(task => ({
      ...task,
      is_completed: true,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    return taskStore.saveMany(updatedTasks);
  },
  
  /**
   * Move tasks to a different list
   */
  moveToList: async (taskIds: string[], newListId: string) => {
    const tasks = await taskStore.getMany(taskIds);
    const updatedTasks = tasks.map(task => ({
      ...task,
      task_list_id: newListId,
      updated_at: new Date().toISOString()
    }));
    return taskStore.saveMany(updatedTasks);
  },
  
  /**
   * Toggle star status for multiple tasks
   */
  toggleStar: async (taskIds: string[]) => {
    const tasks = await taskStore.getMany(taskIds);
    const updatedTasks = tasks.map(task => ({
      ...task,
      is_starred: !task.is_starred,
      updated_at: new Date().toISOString()
    }));
    return taskStore.saveMany(updatedTasks);
  }
};
