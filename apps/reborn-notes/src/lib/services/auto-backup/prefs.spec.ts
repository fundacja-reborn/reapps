/**
 * Tests for the scope-migration helper used by the local→account upgrade:
 * config/state entries must move from the local pseudo user id to the account
 * id (so the upgraded account keeps its backup setup), never overwrite an
 * existing target entry, and always vacate the dead source scope.
 */
import { describe, expect, it } from 'vitest';
import { migrateAutoBackupPrefsScope, type KeyValueStore } from './prefs';

const LOCAL_ID = 'local-uuid';
const ACCOUNT_ID = 'account-uuid';
const configKey = (scope: string) => `reborn-notes:autoBackup:config:${scope}`;
const stateKey = (scope: string) => `reborn-notes:autoBackup:state:${scope}`;

function memoryStore(seed: Record<string, string> = {}): KeyValueStore & {
  dump(): Record<string, string>;
} {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map)
  };
}

describe('migrateAutoBackupPrefsScope', () => {
  it('moves config and state from the local scope to the account scope', () => {
    const store = memoryStore({
      [configKey(LOCAL_ID)]: '{"enabled":true,"folderBookmark":"tree-uri"}',
      [stateKey(LOCAL_ID)]: '{"lastBackupAt":123,"lastError":null}'
    });
    migrateAutoBackupPrefsScope(LOCAL_ID, ACCOUNT_ID, store);
    expect(store.dump()).toEqual({
      [configKey(ACCOUNT_ID)]: '{"enabled":true,"folderBookmark":"tree-uri"}',
      [stateKey(ACCOUNT_ID)]: '{"lastBackupAt":123,"lastError":null}'
    });
  });

  it('never overwrites an existing target entry, but still vacates the source', () => {
    const store = memoryStore({
      [configKey(LOCAL_ID)]: '{"enabled":true}',
      [configKey(ACCOUNT_ID)]: '{"enabled":false}'
    });
    migrateAutoBackupPrefsScope(LOCAL_ID, ACCOUNT_ID, store);
    expect(store.dump()).toEqual({ [configKey(ACCOUNT_ID)]: '{"enabled":false}' });
  });

  it('noops when the source scope has no entries', () => {
    const store = memoryStore({ 'unrelated-key': 'x' });
    migrateAutoBackupPrefsScope(LOCAL_ID, ACCOUNT_ID, store);
    expect(store.dump()).toEqual({ 'unrelated-key': 'x' });
  });

  it('noops when source and target scope are identical', () => {
    const store = memoryStore({ [configKey(LOCAL_ID)]: '{"enabled":true}' });
    migrateAutoBackupPrefsScope(LOCAL_ID, LOCAL_ID, store);
    expect(store.dump()).toEqual({ [configKey(LOCAL_ID)]: '{"enabled":true}' });
  });
});
