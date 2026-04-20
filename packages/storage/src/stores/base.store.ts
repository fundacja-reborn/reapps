import { DB_CONFIG } from '@reborn/types';
import type { StoreDefinition } from '../core/database';
import { createLogger } from '@reborn/utils';

const logger = createLogger('storage:base-store');

/**
 * Shared schema version for all stores. Each app derives its own database
 * name (`Reborn_task_DB` / `Reborn_notes_DB`) inside `getDatabaseConfig()`,
 * so this object intentionally only carries the version.
 */
export const BASE_DB_CONFIG = {
  version: DB_CONFIG.version
};

/**
 * Task-specific store definitions
 */
export const TASK_STORE_DEFINITIONS: StoreDefinition[] = [
  {
    name: 'taskLists',
    primaryKey: 'id',
    indexes: [
      { name: 'user_id', keyPath: 'user_id' },
      { name: 'is_default', keyPath: 'is_default' }
    ]
  },
  {
    name: 'tasks',
    primaryKey: 'id',
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
    ]
  },
  {
    name: 'subtasks',
    primaryKey: 'id',
    indexes: [
      { name: 'task_id', keyPath: 'task_id' },
      { name: 'is_completed', keyPath: 'is_completed' },
      { name: 'position', keyPath: 'position' }
    ]
  }
];

/**
 * Notes-specific store definitions
 */
export const NOTES_STORE_DEFINITIONS: StoreDefinition[] = [
  {
    name: 'notes',
    primaryKey: 'id',
    indexes: [
      { name: 'folder_id', keyPath: 'folder_id' },
      { name: 'is_starred', keyPath: 'is_starred' },
      { name: 'is_pinned', keyPath: 'is_pinned' },
      { name: 'created_at', keyPath: 'created_at' },
      { name: 'updated_at', keyPath: 'updated_at' },
      { name: 'deleted_at', keyPath: 'deleted_at' },
      { name: 'is_archived', keyPath: 'is_archived' }
    ]
  },
  {
    name: 'folders',
    primaryKey: 'id',
    indexes: [
      { name: 'parent_id', keyPath: 'parent_id' },
      { name: 'is_archived', keyPath: 'is_archived' },
      { name: 'order_index', keyPath: 'order_index' }
    ]
  },
  {
    name: 'tags',
    primaryKey: 'id',
    indexes: [
      { name: 'name_encrypted', keyPath: 'name_encrypted' }
    ]
  },
  {
    name: 'noteTags',
    primaryKey: 'id',
    indexes: [
      { name: 'note_id', keyPath: 'note_id' },
      { name: 'tag_id', keyPath: 'tag_id' },
      { name: 'composite', keyPath: ['note_id', 'tag_id'], unique: true }
    ]
  },
  {
    name: 'noteHistory',
    primaryKey: 'id',
    indexes: [
      { name: 'note_id', keyPath: 'note_id' },
      { name: 'created_at', keyPath: 'created_at' }
    ]
  }
];

/**
 * Common store definitions shared by all apps
 */
export const COMMON_STORE_DEFINITIONS: StoreDefinition[] = [
  {
    name: 'appSettings',
    primaryKey: 'id',
    indexes: [
      { name: 'app_name', keyPath: 'app_name' }
    ]
  },
  {
    name: 'syncState',
    primaryKey: 'id'
  },
  {
    name: 'offlineOperations',
    primaryKey: 'id',
    indexes: [
      { name: 'entityType', keyPath: 'entityType' },
      { name: 'status', keyPath: 'status' },
      { name: 'timestamp', keyPath: 'timestamp' }
    ]
  },
  {
    name: 'userSettings',
    primaryKey: 'id'
  }
];

/**
 * Get full database configuration for a specific app.
 * Returns common stores + app-specific stores only.
 */
export function getDatabaseConfig(appName: 'task' | 'notes') {
  const appStores = appName === 'task'
    ? TASK_STORE_DEFINITIONS
    : NOTES_STORE_DEFINITIONS;

  const config = {
    name: `Reborn_${appName}_DB`,
    version: DB_CONFIG.version,
    stores: [...COMMON_STORE_DEFINITIONS, ...appStores]
  };

  logger.info('getDatabaseConfig called', {
    appName,
    name: config.name,
    version: config.version,
    storeCount: config.stores.length,
    storeNames: config.stores.map(s => s.name)
  });

  return config;
}
