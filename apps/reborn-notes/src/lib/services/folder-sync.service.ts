/**
 * Live folder sync - one-way mirror of a local on-disk directory of `.md`
 * files into notes (File System Access API, Chromium-only).
 *
 * The feature is a mechanized version of the manual "re-import folder to
 * refresh" flow: the user links a directory once (`showDirectoryPicker`),
 * the handle is persisted in IndexedDB, and the service re-scans it on app
 * open / return-to-foreground / a periodic interval / a manual button,
 * re-importing only files whose mtime changed since the last completed scan
 * (`filterEntriesChangedSince`) with the `overwrite` strategy - whose
 * unchanged-skip makes the whole run idempotent and cheap.
 *
 * Semantics (deliberate, see TODO entry "live folder sync"):
 * - One-way disk → app. In-app edits survive until the file on disk
 *   changes again; then disk wins.
 * - Sync NEVER deletes or trashes notes: a file deleted on disk leaves the
 *   note alone; a renamed file imports as a new note (the old one stays).
 * - Zero Knowledge untouched: scanning, parsing and encryption all happen
 *   client-side through the same import path as a manual folder import; the
 *   directory handle never leaves the browser profile.
 *
 * On browsers without the API (Safari/Firefox/native shell) the feature
 * reports `unsupported` and stays invisible beyond a hint in settings.
 */

import { get, writable } from 'svelte/store';
import { browser } from '$app/environment';
import { folderSyncStore, type FolderSyncConfigRecord } from '@reborn/storage';
import { createLogger } from '@reborn/utils';
import { authStore } from '$lib/stores/auth.store';
import { notesStore } from '$lib/stores/notes.store';
import { foldersStore } from '$lib/stores/folders.store';
import { tagsStore } from '$lib/stores/tags.store';
import {
  importFolder,
  type ImportFolderResult,
  type ImportProgress
} from './export-import.service';
import { collectMarkdownEntries, filterEntriesChangedSince } from './folder-sync-utils';

const logger = createLogger('notes:folder-sync');

/** Single-config id - the v1 UI links at most one directory. */
const SINGLETON_ID = 'default';
/** Minimum spacing between automatic runs (focus events can fire in bursts). */
const AUTO_COOLDOWN_MS = 60_000;
/** Periodic re-scan while the app stays visible. */
const AUTO_INTERVAL_MS = 5 * 60_000;
/** Picker memory key - reopens the chooser near the previously picked dir. */
const PICKER_ID = 'reborn-folder-sync';
/** Web Locks name guarding against two tabs importing concurrently. */
const LOCK_NAME = 'reborn-notes-folder-sync';

export type FolderSyncState =
  | 'unsupported'
  | 'unconfigured'
  | 'idle'
  | 'syncing'
  | 'needs-permission'
  | 'error';

export type FolderSyncErrorKey = 'folder_gone' | 'sync_failed' | null;

export type FolderSyncStatus = {
  state: FolderSyncState;
  rootName: string | null;
  autoSync: boolean;
  lastSyncAt: string | null;
  lastResult: FolderSyncConfigRecord['last_result'];
  progress: ImportProgress | null;
  errorKey: FolderSyncErrorKey;
};

export function isFolderSyncSupported(): boolean {
  return browser && typeof window.showDirectoryPicker === 'function';
}

const initialStatus: FolderSyncStatus = {
  state: isFolderSyncSupported() ? 'unconfigured' : 'unsupported',
  rootName: null,
  autoSync: false,
  lastSyncAt: null,
  lastResult: null,
  progress: null,
  errorKey: null
};

export const folderSyncStatus = writable<FolderSyncStatus>(initialStatus);

/** Per-tab single-flight flag; cross-tab exclusion is the Web Lock below. */
let syncing = false;
let lastAutoRunAt = 0;

async function readConfig(): Promise<FolderSyncConfigRecord | null> {
  try {
    return await folderSyncStore.get(SINGLETON_ID);
  } catch (e: unknown) {
    logger.warn('Failed to read folder sync config', e);
    return null;
  }
}

/** Non-prompting permission probe; treats probe failure as "needs re-grant". */
async function queryReadPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  try {
    return await handle.queryPermission({ mode: 'read' });
  } catch (e: unknown) {
    logger.warn('queryPermission failed', e);
    return 'prompt';
  }
}

/**
 * Re-read the persisted config and project it into `folderSyncStatus`.
 * IndexedDB is the source of truth - the in-memory store is only a reactive
 * mirror for the settings UI, so this is safe to call at any time (mount,
 * after logout, after any state-changing operation).
 */
export async function refreshFolderSyncStatus(): Promise<void> {
  if (!isFolderSyncSupported()) {
    folderSyncStatus.set({ ...initialStatus, state: 'unsupported' });
    return;
  }
  const cfg = await readConfig();
  if (!cfg) {
    folderSyncStatus.update((s) => ({
      ...initialStatus,
      state: 'unconfigured',
      // A sync still in flight keeps its progress UI (e.g. right after
      // unlink the syncing flag can't be set, so this is belt-and-braces).
      progress: syncing ? s.progress : null
    }));
    return;
  }
  const perm = await queryReadPermission(cfg.handle as FileSystemDirectoryHandle);
  folderSyncStatus.update((s) => ({
    ...s,
    state: syncing ? 'syncing' : perm === 'granted' ? 'idle' : 'needs-permission',
    rootName: cfg.root_name,
    autoSync: cfg.auto_sync === 1,
    lastSyncAt: cfg.last_sync_at,
    lastResult: cfg.last_result,
    progress: syncing ? s.progress : null
  }));
}

/**
 * Open the directory picker, persist the handle and run the initial full
 * import. Must be called from a user gesture (button click) - the picker
 * and the permission grant both require transient activation.
 *
 * Returns the initial import result, or `null` when the user cancelled the
 * picker / the import could not run.
 */
export async function linkFolder(): Promise<ImportFolderResult | null> {
  if (!isFolderSyncSupported()) return null;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: 'read' });
  } catch (e: unknown) {
    // AbortError = user dismissed the picker - not an error.
    if (!(e instanceof DOMException && e.name === 'AbortError')) {
      logger.warn('showDirectoryPicker failed', e);
    }
    return null;
  }

  const record: FolderSyncConfigRecord = {
    id: SINGLETON_ID,
    handle,
    root_name: handle.name,
    auto_sync: 1,
    last_sync_at: null,
    last_result: null,
    created_at: new Date().toISOString()
  };
  await folderSyncStore.save(record);
  await refreshFolderSyncStatus();
  // Initial full import right away - the picker click is the user gesture.
  return runFolderSync('manual');
}

/** Remove the link. Imported notes/folders/tags are left untouched. */
export async function unlinkFolder(): Promise<void> {
  try {
    await folderSyncStore.delete(SINGLETON_ID);
  } catch (e: unknown) {
    logger.warn('Failed to delete folder sync config', e);
  }
  await refreshFolderSyncStatus();
}

/** Toggle automatic runs (focus + interval). Manual "Sync now" always works. */
export async function setFolderAutoSync(enabled: boolean): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) return;
  await folderSyncStore.save({ ...cfg, auto_sync: enabled ? 1 : 0 });
  await refreshFolderSyncStatus();
}

/**
 * Scan the linked directory and import changed files.
 *
 * `auto` runs (focus / interval / app open) are fully silent: they bail on
 * missing auth, disabled toggle, hidden tab, cooldown, or a permission that
 * would require a prompt. `manual` runs may call `requestPermission()`
 * (caller guarantees a user gesture) and ignore cooldown/toggle.
 */
export async function runFolderSync(
  trigger: 'manual' | 'auto'
): Promise<ImportFolderResult | null> {
  if (!isFolderSyncSupported() || syncing) return null;

  const auth = get(authStore);
  if (!auth.isAuthenticated || !auth.hasE2E) return null;

  const cfg = await readConfig();
  if (!cfg) return null;

  if (trigger === 'auto') {
    if (cfg.auto_sync !== 1) return null;
    if (document.visibilityState !== 'visible') return null;
    if (Date.now() - lastAutoRunAt < AUTO_COOLDOWN_MS) return null;
  }

  const handle = cfg.handle as FileSystemDirectoryHandle;
  let perm = await queryReadPermission(handle);
  if (perm !== 'granted' && trigger === 'manual') {
    try {
      perm = await handle.requestPermission({ mode: 'read' });
    } catch (e: unknown) {
      logger.warn('requestPermission failed', e);
      perm = 'denied';
    }
  }
  if (perm !== 'granted') {
    folderSyncStatus.update((s) => ({ ...s, state: 'needs-permission' }));
    return null;
  }

  syncing = true;
  if (trigger === 'auto') lastAutoRunAt = Date.now();
  folderSyncStatus.update((s) => ({ ...s, state: 'syncing', errorKey: null, progress: null }));

  try {
    const result = await withCrossTabLock(() => scanAndImport(cfg, handle));
    syncing = false;
    await refreshFolderSyncStatus();
    return result;
  } catch (e: unknown) {
    syncing = false;
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotFoundError') {
      // Directory moved/deleted on disk - keep the config so the user can
      // restore the directory; surface a targeted message instead.
      logger.warn('Linked directory not found on disk', e);
      folderSyncStatus.update((s) => ({
        ...s,
        state: 'error',
        errorKey: 'folder_gone',
        progress: null
      }));
    } else if (name === 'SecurityError' || name === 'NotAllowedError') {
      folderSyncStatus.update((s) => ({ ...s, state: 'needs-permission', progress: null }));
    } else {
      logger.error('Folder sync failed', e);
      folderSyncStatus.update((s) => ({
        ...s,
        state: 'error',
        errorKey: 'sync_failed',
        progress: null
      }));
    }
    return null;
  }
}

/**
 * Run `fn` under a Web Lock so two tabs never import concurrently (both
 * would race the duplicate-title lookup and could double-create notes).
 * `ifAvailable` + null-return means "the other tab is already syncing" -
 * skip silently; its run covers the same disk state.
 */
async function withCrossTabLock(
  fn: () => Promise<ImportFolderResult | null>
): Promise<ImportFolderResult | null> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        logger.debug('Folder sync lock busy (another tab) - skipping run');
        return null;
      }
      return fn();
    });
  }
  return fn();
}

async function scanAndImport(
  cfg: FolderSyncConfigRecord,
  handle: FileSystemDirectoryHandle
): Promise<ImportFolderResult | null> {
  // Watermark is captured BEFORE the walk: files modified mid-scan get an
  // mtime newer than this and are re-picked next run (the unchanged-skip
  // absorbs the overlap).
  const scanStartedAt = new Date().toISOString();

  const { entries, skippedTooDeep } = await collectMarkdownEntries(handle);
  if (skippedTooDeep > 0) {
    logger.warn('Folder sync: subtree(s) deeper than the depth cap were skipped', {
      skippedTooDeep
    });
  }

  const changed = filterEntriesChangedSince(entries, cfg.last_sync_at);

  let result: ImportFolderResult | null = null;
  if (changed.length > 0) {
    // Fixed `overwrite` strategy: `rename` would mint "(2)" copies on every
    // run and `skip` would never propagate disk edits. The unchanged-skip
    // inside overwrite keeps no-op refreshes free of writes and sync pushes.
    result = await importFolder(
      changed,
      'overwrite',
      (p) => folderSyncStatus.update((s) => ({ ...s, progress: p })),
      { keepRootFolder: true }
    );
  }

  if (result && (result.imported > 0 || result.foldersCreated > 0 || result.tagsCreated > 0)) {
    await Promise.all([notesStore.refresh(), foldersStore.refresh(), tagsStore.refresh()]);
  }

  // Advance the watermark even when some files errored: per-file errors are
  // surfaced in lastResult, and a persistently failing file must not force
  // every future run to re-read the whole changed set.
  //
  // Re-read the record instead of saving the captured `cfg`: a long import
  // leaves time to unlink (saving would resurrect the deleted record) or
  // flip the auto-sync toggle (saving stale cfg would revert it).
  const latest = await folderSyncStore.get(cfg.id);
  if (!latest) return result;
  const updated: FolderSyncConfigRecord = {
    ...latest,
    last_sync_at: scanStartedAt,
    last_result: {
      scanned: entries.length,
      imported: result?.imported ?? 0,
      unchanged: result?.duplicatesUnchanged ?? 0,
      errors: result?.errors.length ?? 0
    }
  };
  await folderSyncStore.save(updated);

  logger.info('Folder sync run complete', {
    scanned: entries.length,
    changed: changed.length,
    imported: result?.imported ?? 0,
    unchanged: result?.duplicatesUnchanged ?? 0,
    errors: result?.errors.length ?? 0
  });
  return result;
}

/**
 * Wire the automatic triggers (return-to-foreground + periodic interval).
 * Call once from the root layout after storage init; returns a cleanup.
 * Every trigger re-validates everything inside `runFolderSync`, so the
 * listeners themselves stay dumb and safe to keep attached while logged out.
 */
export function initFolderSync(): () => void {
  if (!isFolderSyncSupported()) return () => {};

  void refreshFolderSyncStatus();

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void runFolderSync('auto');
  };
  document.addEventListener('visibilitychange', onVisibility);
  const interval = setInterval(() => void runFolderSync('auto'), AUTO_INTERVAL_MS);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(interval);
  };
}
