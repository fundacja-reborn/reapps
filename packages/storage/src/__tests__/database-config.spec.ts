import { describe, it, expect } from 'vitest';
import {
  getDatabaseConfig,
  TASK_STORE_DEFINITIONS,
  NOTES_STORE_DEFINITIONS,
  COMMON_STORE_DEFINITIONS
} from '../stores/base.store';

const GHOST_STORES = ['idMappings', 'authCredentials'];

describe('getDatabaseConfig', () => {
  it('returns only task + common stores for task app', () => {
    const config = getDatabaseConfig('task');
    const names = config.stores.map((s) => s.name);

    // Has all task stores
    for (const def of TASK_STORE_DEFINITIONS) {
      expect(names).toContain(def.name);
    }
    // Has all common stores
    for (const def of COMMON_STORE_DEFINITIONS) {
      expect(names).toContain(def.name);
    }
    // Does NOT have notes stores
    for (const def of NOTES_STORE_DEFINITIONS) {
      expect(names).not.toContain(def.name);
    }
    // Does NOT have ghost stores
    for (const ghost of GHOST_STORES) {
      expect(names).not.toContain(ghost);
    }

    expect(names).toHaveLength(TASK_STORE_DEFINITIONS.length + COMMON_STORE_DEFINITIONS.length);
  });

  it('returns only notes + common stores for notes app', () => {
    const config = getDatabaseConfig('notes');
    const names = config.stores.map((s) => s.name);

    // Has all notes stores
    for (const def of NOTES_STORE_DEFINITIONS) {
      expect(names).toContain(def.name);
    }
    // Has all common stores
    for (const def of COMMON_STORE_DEFINITIONS) {
      expect(names).toContain(def.name);
    }
    // Does NOT have task stores
    for (const def of TASK_STORE_DEFINITIONS) {
      expect(names).not.toContain(def.name);
    }
    // Does NOT have ghost stores
    for (const ghost of GHOST_STORES) {
      expect(names).not.toContain(ghost);
    }

    expect(names).toHaveLength(NOTES_STORE_DEFINITIONS.length + COMMON_STORE_DEFINITIONS.length);
  });

  it('sets correct database name per app', () => {
    expect(getDatabaseConfig('task').name).toBe('Reborn_task_DB');
    expect(getDatabaseConfig('notes').name).toBe('Reborn_notes_DB');
  });

  it('uses version from DB_CONFIG', async () => {
    const { DB_CONFIG } = await import('@reborn/types');
    expect(getDatabaseConfig('task').version).toBe(DB_CONFIG.version);
    expect(getDatabaseConfig('notes').version).toBe(DB_CONFIG.version);
  });
});
