/**
 * Device-local persistence for the automated-backup feature (config + runtime
 * state). Stored in `localStorage`, NEVER synced to the server: the values are
 * device-scoped by nature (a native folder bookmark is meaningless on another
 * device) and keeping them out of the synced `AppSettings` bundle guarantees
 * they can never ride a settings push to the server - a Zero Knowledge
 * guardrail, not just a convenience.
 *
 * Why `localStorage` and not an IndexedDB store like folder-sync: folder-sync
 * must persist a non-serializable web `FileSystemDirectoryHandle`, which only
 * structured-clone (IndexedDB) can hold. Our native target is a *string*
 * bookmark, so plain `localStorage` fits and avoids a DB version bump. When the
 * web read/write target (Faza 2) needs to persist an FSA handle, that handle
 * gets its own small IndexedDB store; this metadata stays here.
 *
 * The recovery phrase is deliberately NOT stored here - it is a secret and
 * lives in the OS secure vault (`recovery-phrase-vault.ts`).
 *
 * Everything is keyed PER USER (account id or local-only pseudo id), never
 * globally for the origin: a shared device must not let account B inherit
 * account A's backup destination - A controls that folder and knows the
 * phrase, so B's notes would land somewhere A can read them. The same scope id
 * keys the phrase in the OS vault. Logout additionally wipes the current
 * user's entries (see `clearAutoBackupState`).
 */

import {
  DEFAULT_AUTO_BACKUP_CONFIG,
  DEFAULT_RETENTION,
  type AutoBackupConfig,
  type AutoBackupState
} from '@reborn/backup';

const CONFIG_KEY_PREFIX = 'reborn-notes:autoBackup:config';
const STATE_KEY_PREFIX = 'reborn-notes:autoBackup:state';

// The shared cross-app session keys (duplicated string literals from
// auth.store on purpose: they are a frozen cross-app storage contract, and
// importing the store here would drag the whole svelte/crypto graph into this
// otherwise dependency-free module).
const CREDENTIALS_KEY = 'reborn_auth_credentials';
const LOCAL_MODE_KEY = 'reborn_local_mode';
const LOCAL_USER_ID_KEY = 'reborn_local_user_id';

/**
 * Notes-side auto-backup config: the shared tunables plus the device-local
 * handle to the chosen folder. Assignable to {@link AutoBackupConfig} so it can
 * be passed straight to `runAutoBackup`.
 */
export interface NotesAutoBackupConfig extends AutoBackupConfig {
  /**
   * Native security-scoped bookmark (iOS) / SAF tree-Uri string (Android) of
   * the target folder. Absent until the user picks one. Not a secret (a
   * capability handle, like folder-sync's), so plain device-local storage is
   * appropriate.
   */
  folderBookmark?: string;
  /** Display label for the chosen folder (its leaf name), for the settings UI. */
  folderName?: string;
}

export const DEFAULT_NOTES_AUTO_BACKUP_CONFIG: NotesAutoBackupConfig = {
  ...DEFAULT_AUTO_BACKUP_CONFIG
};

const DEFAULT_STATE: AutoBackupState = { lastBackupAt: null, lastError: null };

/** The minimal synchronous string store this module needs (a `localStorage`). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `localStorage` if reachable, else null. Access can throw (SSR, or a browser
 * privacy mode that disables storage), and the test runner is node - so every
 * caller degrades to defaults / no-ops rather than crashing the app.
 */
function safeLocalStorage(): KeyValueStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * The identity that scopes every auto-backup artifact on this device: the
 * account user id when a session exists, the device-scoped local-only pseudo
 * user id otherwise (both random UUIDs, so derived keys never collide). Null
 * when there is no session at all - then there is nothing to read or write.
 * Mirrors the precedence in auth.store's `readFromStorage` (account wins).
 */
export function autoBackupScopeId(store = safeLocalStorage()): string | null {
  if (!store) return null;
  try {
    const raw = store.getItem(CREDENTIALS_KEY);
    if (raw) {
      const creds = JSON.parse(raw) as { id?: string };
      if (creds?.id) return creds.id;
    }
  } catch {
    // Malformed credentials - fall through to the local-only marker.
  }
  if (store.getItem(LOCAL_MODE_KEY) === '1') {
    return store.getItem(LOCAL_USER_ID_KEY);
  }
  return null;
}

const configKey = (scopeId: string): string => `${CONFIG_KEY_PREFIX}:${scopeId}`;
const stateKey = (scopeId: string): string => `${STATE_KEY_PREFIX}:${scopeId}`;

/** Load the persisted config, merged over defaults. `store` is injectable for tests. */
export function loadAutoBackupConfig(store = safeLocalStorage()): NotesAutoBackupConfig {
  const scopeId = autoBackupScopeId(store);
  const raw = scopeId ? store?.getItem(configKey(scopeId)) : null;
  if (!raw) return { ...DEFAULT_NOTES_AUTO_BACKUP_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Partial<NotesAutoBackupConfig>;
    return {
      ...DEFAULT_NOTES_AUTO_BACKUP_CONFIG,
      ...parsed,
      // Merge retention field-by-field so a partial stored object can't drop a key.
      retention: { ...DEFAULT_RETENTION, ...(parsed.retention ?? {}) }
    };
  } catch {
    return { ...DEFAULT_NOTES_AUTO_BACKUP_CONFIG };
  }
}

/** Persist the config. No-op when storage is unreachable or no session exists. */
export function saveAutoBackupConfig(
  config: NotesAutoBackupConfig,
  store = safeLocalStorage()
): void {
  const scopeId = autoBackupScopeId(store);
  if (!scopeId) return;
  store?.setItem(configKey(scopeId), JSON.stringify(config));
}

/** Load the persisted runtime state, merged over defaults. */
export function loadAutoBackupState(store = safeLocalStorage()): AutoBackupState {
  const scopeId = autoBackupScopeId(store);
  const raw = scopeId ? store?.getItem(stateKey(scopeId)) : null;
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<AutoBackupState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Persist the runtime state. No-op when storage is unreachable or no session exists. */
export function saveAutoBackupState(state: AutoBackupState, store = safeLocalStorage()): void {
  const scopeId = autoBackupScopeId(store);
  if (!scopeId) return;
  store?.setItem(stateKey(scopeId), JSON.stringify(state));
}

/**
 * Copy the config and state entries from one scope id to another. Used by the
 * local→account upgrade: the upgrade flips `autoBackupScopeId()` from the
 * local pseudo user id to the account id, which would orphan the local-only
 * user's backup setup (folder bookmark, enabled flag, cadence state) under
 * keys nothing reads any more. Same device, same human, same folder grant -
 * carrying the setup over is safe and spares a full re-setup. The target
 * scope is only written where it has no entry of its own (it never does in
 * practice: logout wipes account-scoped entries), and the source entries are
 * removed so nothing lingers under the dead scope.
 */
export function migrateAutoBackupPrefsScope(
  fromScopeId: string,
  toScopeId: string,
  store = safeLocalStorage()
): void {
  if (!store || fromScopeId === toScopeId) return;
  for (const keyFor of [configKey, stateKey]) {
    const value = store.getItem(keyFor(fromScopeId));
    if (value !== null && store.getItem(keyFor(toScopeId)) === null) {
      store.setItem(keyFor(toScopeId), value);
    }
    store.removeItem(keyFor(fromScopeId));
  }
}

/**
 * Remove the persisted config and state of the CURRENT user. Called on logout
 * and on the local-only wipe, while the session keys are still readable - the
 * next account on this device must not inherit this user's backup target.
 * Also sweeps the pre-scoping global keys (early native builds) so no stale
 * folder bookmark survives the upgrade.
 */
export function clearAutoBackupPrefs(store = safeLocalStorage()): void {
  if (!store) return;
  const scopeId = autoBackupScopeId(store);
  if (scopeId) {
    store.removeItem(configKey(scopeId));
    store.removeItem(stateKey(scopeId));
  }
  // Legacy unscoped keys from builds before per-user scoping.
  store.removeItem(CONFIG_KEY_PREFIX);
  store.removeItem(STATE_KEY_PREFIX);
}
