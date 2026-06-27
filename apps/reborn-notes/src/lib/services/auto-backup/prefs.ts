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
 */

import {
  DEFAULT_AUTO_BACKUP_CONFIG,
  DEFAULT_RETENTION,
  type AutoBackupConfig,
  type AutoBackupState
} from '@reborn/backup';

const CONFIG_KEY = 'reborn-notes:autoBackup:config';
const STATE_KEY = 'reborn-notes:autoBackup:state';

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

/** Load the persisted config, merged over defaults. `store` is injectable for tests. */
export function loadAutoBackupConfig(store = safeLocalStorage()): NotesAutoBackupConfig {
  const raw = store?.getItem(CONFIG_KEY);
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

/** Persist the config. No-op when storage is unreachable. */
export function saveAutoBackupConfig(
  config: NotesAutoBackupConfig,
  store = safeLocalStorage()
): void {
  store?.setItem(CONFIG_KEY, JSON.stringify(config));
}

/** Load the persisted runtime state, merged over defaults. */
export function loadAutoBackupState(store = safeLocalStorage()): AutoBackupState {
  const raw = store?.getItem(STATE_KEY);
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<AutoBackupState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Persist the runtime state. No-op when storage is unreachable. */
export function saveAutoBackupState(state: AutoBackupState, store = safeLocalStorage()): void {
  store?.setItem(STATE_KEY, JSON.stringify(state));
}
