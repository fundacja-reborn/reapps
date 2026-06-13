/**
 * Live folder sync - one-way mirror of local on-disk directories of `.md`
 * files into notes (File System Access API, Chromium-only).
 *
 * The feature is a mechanized version of the manual "re-import folder to
 * refresh" flow: the user links a directory (`showDirectoryPicker`), the
 * handle is persisted in IndexedDB, and the service re-scans it on app
 * open / return-to-foreground / a periodic interval / a manual button,
 * re-importing only files whose path is new or whose mtime changed since
 * the last completed scan (`filterEntriesToSync`) with the `overwrite`
 * strategy - whose unchanged-skip makes the whole run idempotent and cheap.
 *
 * Multiple directories can be linked (capped at
 * {@link MAX_FOLDER_SYNC_CONFIGS}). Each config carries a display name
 * chosen at link time: it labels the entry in settings AND names the
 * top-level folder the import targets, so two sources that share an on-disk
 * name end up in two distinct folders. A run iterates configs SEQUENTIALLY
 * under one cross-tab Web Lock - two concurrent imports would race the
 * duplicate-title lookup - and isolates errors per config, so one broken
 * directory never blocks the rest.
 *
 * Semantics (deliberate, see TODO entry "live folder sync"):
 * - One-way disk → app. In-app edits survive until the file on disk
 *   changes again; then disk wins.
 * - Sync NEVER deletes or trashes notes: a file deleted on disk leaves the
 *   note alone; a renamed file imports as a new note (the old one stays).
 *   The same applies to a config's display name - it is fixed at link time
 *   (rename = unlink + relink), because renaming would re-target a fresh
 *   top-level folder and orphan the previous one.
 * - Zero Knowledge untouched: scanning, parsing and encryption all happen
 *   client-side through the same import path as a manual folder import; the
 *   directory handles never leave the browser profile.
 *
 * On browsers without the API (Safari/Firefox/native shell) the feature
 * reports unsupported and stays invisible beyond a hint in settings.
 */

import { get, writable, derived } from 'svelte/store';
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
import { collectMarkdownEntries, filterEntriesToSync } from './folder-sync-utils';

const logger = createLogger('notes:folder-sync');

/**
 * Soft cap on linked directories - every config adds a directory walk to the
 * periodic auto-run, so the ceiling keeps unattended background work bounded.
 * Raising it is a one-constant change.
 */
export const MAX_FOLDER_SYNC_CONFIGS = 5;
/** Minimum spacing between automatic runs (focus events can fire in bursts). */
const AUTO_COOLDOWN_MS = 60_000;
/** Periodic re-scan while the app stays visible. */
const AUTO_INTERVAL_MS = 5 * 60_000;
/** Picker memory key - reopens the chooser near the previously picked dir. */
const PICKER_ID = 'reborn-folder-sync';
/** Web Locks name guarding against two tabs importing concurrently. */
const LOCK_NAME = 'reborn-notes-folder-sync';
/**
 * Characters forbidden in a destination (app folder) name. The import path
 * walk splits on "/" (`extractFolderSegments`), so a slash would silently
 * nest - "a/b" would create folder "a" containing "b" instead of one folder
 * named "a/b". A backslash reads as a path separator too. The destination
 * must map to exactly one top-level folder, so both are rejected.
 */
const ILLEGAL_DEST_NAME_CHARS = /[/\\]/;

export type FolderSyncErrorKey = 'folder_gone' | 'sync_failed' | null;

/** Reactive projection of one linked directory, for the settings UI. */
export type FolderSyncConfigStatus = {
  id: string;
  /** Display name (= target top-level folder); editable via `updateFolderSyncConfig`. */
  name: string;
  /** On-disk directory leaf name; the UI's fallback + placeholder when no `sourceLabel`. */
  dirName: string;
  /** User-set cosmetic label for the source directory; null = fall back to `dirName`. */
  sourceLabel: string | null;
  state: 'idle' | 'syncing' | 'needs-permission' | 'error';
  autoSync: boolean;
  lastSyncAt: string | null;
  lastResult: FolderSyncConfigRecord['last_result'];
  progress: ImportProgress | null;
  errorKey: FolderSyncErrorKey;
};

export function isFolderSyncSupported(): boolean {
  return browser && typeof window.showDirectoryPicker === 'function';
}

/**
 * One status entry per linked directory, ordered by link time. Empty while
 * nothing is linked (or the browser lacks the API - the UI feature-detects
 * separately via `isFolderSyncSupported`).
 */
export const folderSyncStatus = writable<FolderSyncConfigStatus[]>([]);

/**
 * Map of (lowercased) display name → config id, for the folder UI to mark a
 * folder as a sync destination and offer "Sync now" on it. The destination
 * is always a TOP-LEVEL folder (the import roots at `root_name`), so callers
 * must additionally gate on the folder being top-level - a nested folder that
 * coincidentally shares the name is NOT a sync target. Empty when nothing is
 * linked or the browser lacks the API.
 */
export const syncedFolderConfigs = derived(folderSyncStatus, ($list) => {
  const byName = new Map<string, string>();
  for (const s of $list) byName.set(s.name.toLowerCase(), s.id);
  return byName;
});

/** Per-tab single-flight flag; cross-tab exclusion is the Web Lock below. */
let runnerActive = false;
/** Config currently being imported - lets a mid-run refresh keep its state. */
let activeConfigId: string | null = null;
let lastAutoRunAt = 0;

/** All configs, oldest link first (stable order for the settings list). */
async function readConfigs(): Promise<FolderSyncConfigRecord[]> {
  try {
    const all = await folderSyncStore.getAll();
    return all.sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    );
  } catch (e: unknown) {
    logger.warn('Failed to read folder sync configs', e);
    return [];
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

function patchStatus(id: string, patch: Partial<FolderSyncConfigStatus>): void {
  folderSyncStatus.update((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

async function projectConfigStatus(cfg: FolderSyncConfigRecord): Promise<FolderSyncConfigStatus> {
  const handle = cfg.handle as FileSystemDirectoryHandle;
  const perm = await queryReadPermission(handle);
  return {
    id: cfg.id,
    name: cfg.root_name,
    dirName: handle.name,
    sourceLabel: cfg.source_label ?? null,
    state: perm === 'granted' ? 'idle' : 'needs-permission',
    autoSync: cfg.auto_sync === 1,
    lastSyncAt: cfg.last_sync_at,
    lastResult: cfg.last_result,
    progress: null,
    errorKey: null
  };
}

/**
 * Re-read the persisted configs and project them into `folderSyncStatus`.
 * IndexedDB is the source of truth - the in-memory store is only a reactive
 * mirror for the settings UI, so this is safe to call at any time (mount,
 * after logout, after any state-changing operation). A config the runner is
 * importing right now keeps its live syncing state and progress.
 */
export async function refreshFolderSyncStatus(): Promise<void> {
  if (!isFolderSyncSupported()) {
    folderSyncStatus.set([]);
    return;
  }
  const cfgs = await readConfigs();
  const fresh = await Promise.all(cfgs.map(projectConfigStatus));
  folderSyncStatus.update((current) => {
    if (!runnerActive || activeConfigId === null) return fresh;
    return fresh.map((f) => {
      if (f.id !== activeConfigId) return f;
      const live = current.find((c) => c.id === f.id);
      return { ...f, state: 'syncing' as const, progress: live?.progress ?? null };
    });
  });
}

/** Outcome of the directory picker step of the add-folder flow. */
export type PickFolderOutcome =
  | { kind: 'picked'; handle: FileSystemDirectoryHandle }
  | { kind: 'cancelled' }
  | { kind: 'limit-reached' }
  | { kind: 'already-linked'; name: string };

/**
 * Open the directory picker and vet the choice against existing configs.
 * Must be called from a user gesture (button click) - the picker and its
 * implicit read grant require transient activation. The config is NOT
 * created yet: the caller collects the display name first and then calls
 * `addLinkedFolder` with the returned handle.
 */
export async function pickFolderToLink(): Promise<PickFolderOutcome> {
  if (!isFolderSyncSupported()) return { kind: 'cancelled' };
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: 'read' });
  } catch (e: unknown) {
    // AbortError = user dismissed the picker - not an error.
    if (!(e instanceof DOMException && e.name === 'AbortError')) {
      logger.warn('showDirectoryPicker failed', e);
    }
    return { kind: 'cancelled' };
  }
  const configs = await readConfigs();
  if (configs.length >= MAX_FOLDER_SYNC_CONFIGS) return { kind: 'limit-reached' };
  for (const cfg of configs) {
    if (await isSameDirectory(handle, cfg.handle as FileSystemDirectoryHandle)) {
      return { kind: 'already-linked', name: cfg.root_name };
    }
  }
  return { kind: 'picked', handle };
}

async function isSameDirectory(
  a: FileSystemDirectoryHandle,
  b: FileSystemDirectoryHandle
): Promise<boolean> {
  try {
    return await a.isSameEntry(b);
  } catch (e: unknown) {
    logger.warn('isSameEntry failed', e);
    return false;
  }
}

export type AddFolderOutcome =
  | { ok: true; id: string }
  | { ok: false; error: 'name-empty' | 'name-invalid' | 'name-taken' | 'limit-reached' };

/**
 * Persist a new config for a handle obtained from `pickFolderToLink`.
 *
 * `displayName` (default in the UI: the directory name) must be unique
 * across configs case-insensitively - it is both the label and the target
 * top-level folder, so a duplicate would silently merge two sources.
 * Colliding with an EXISTING app folder is fine and deliberate: the import
 * find-or-creates the folder, letting users target a folder they already
 * have. Returns fast - the caller kicks off the initial import with
 * `runFolderSync('manual', id)` so the UI can close the form while the
 * import streams progress into the new list entry.
 */
export async function addLinkedFolder(
  handle: FileSystemDirectoryHandle,
  displayName: string
): Promise<AddFolderOutcome> {
  const name = displayName.trim();
  if (!name) return { ok: false, error: 'name-empty' };
  if (ILLEGAL_DEST_NAME_CHARS.test(name)) return { ok: false, error: 'name-invalid' };
  const configs = await readConfigs();
  if (configs.length >= MAX_FOLDER_SYNC_CONFIGS) return { ok: false, error: 'limit-reached' };
  if (configs.some((c) => c.root_name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'name-taken' };
  }
  const record: FolderSyncConfigRecord = {
    id: crypto.randomUUID(),
    handle,
    root_name: name,
    auto_sync: 1,
    last_sync_at: null,
    last_result: null,
    created_at: new Date().toISOString()
  };
  await folderSyncStore.save(record);
  await refreshFolderSyncStatus();
  return { ok: true, id: record.id };
}

export type UpdateFolderSyncOutcome =
  | { ok: true }
  | { ok: false; error: 'name-empty' | 'name-invalid' | 'name-taken' | 'dest-folder-exists' };

/**
 * Edit a linked folder's two user-facing names.
 *
 * - `sourceLabel` is a cosmetic, device-local annotation of the on-disk
 *   directory (see {@link FolderSyncConfigRecord.source_label}). Blank clears
 *   it (the UI then falls back to the on-disk leaf name). It never affects
 *   which directory is read - dedup is by handle identity, not by name.
 *
 * - `destName` is the top-level app folder the import targets (the config's
 *   `root_name`). Renaming it renames that existing app folder IN PLACE, so
 *   the notes already imported move with it, and points future syncs at the
 *   new name. Imports match the target folder by name, so:
 *     - a collision with a DIFFERENT existing top-level folder is rejected
 *       (renaming into it would orphan content into a confusing duplicate);
 *     - the name must stay unique across configs (case-insensitive).
 *   The scan watermark and known-paths set are reset on a destination change
 *   so the next run re-homes the tree even when no app folder was found to
 *   rename (e.g. the user deleted it); the overwrite strategy's unchanged-skip
 *   keeps that re-scan write-free when the content already matches.
 *
 * Call only when this config is idle (the settings UI disables editing while
 * a sync runs) - it mutates the same record and target folder the runner uses.
 */
export async function updateFolderSyncConfig(
  configId: string,
  changes: { sourceLabel: string | null; destName: string }
): Promise<UpdateFolderSyncOutcome> {
  const cfg = await folderSyncStore.get(configId);
  if (!cfg) return { ok: true }; // already unlinked - nothing to update

  const newName = changes.destName.trim();
  if (!newName) return { ok: false, error: 'name-empty' };
  if (ILLEGAL_DEST_NAME_CHARS.test(newName)) return { ok: false, error: 'name-invalid' };
  const newLabel = changes.sourceLabel?.trim() ? changes.sourceLabel.trim() : null;

  const oldName = cfg.root_name;
  const destChanged = newName !== oldName;

  if (destChanged) {
    const lower = newName.toLowerCase();
    const others = (await readConfigs()).filter((c) => c.id !== configId);
    if (others.some((c) => c.root_name.toLowerCase() === lower)) {
      return { ok: false, error: 'name-taken' };
    }
    // Rename the existing top-level app folder so imported notes travel with
    // it (top-level folders are the root array of the tree). A new name that
    // collides with a DIFFERENT top-level folder is rejected - find-or-create
    // by name would otherwise route future imports into a duplicate.
    await foldersStore.refresh();
    const topLevel = get(foldersStore);
    const own = topLevel.find((f) => f.name.toLowerCase() === oldName.toLowerCase());
    const collision = topLevel.find((f) => f.name.toLowerCase() === lower && f.id !== own?.id);
    if (collision) return { ok: false, error: 'dest-folder-exists' };
    if (own) await foldersStore.rename(own.id, newName);
  }

  const updated: FolderSyncConfigRecord = {
    ...cfg,
    source_label: newLabel,
    root_name: newName,
    // A renamed destination invalidates the path-prefixed known set and the
    // mtime watermark; reset both so the next scan reconciles into the new
    // folder (write-free via unchanged-skip when content already matches).
    ...(destChanged ? { known_paths: undefined, last_sync_at: null } : {})
  };
  await folderSyncStore.save(updated);
  await refreshFolderSyncStatus();
  return { ok: true };
}

/** Remove one link. Imported notes/folders/tags are left untouched. */
export async function unlinkFolder(configId: string): Promise<void> {
  try {
    await folderSyncStore.delete(configId);
  } catch (e: unknown) {
    logger.warn('Failed to delete folder sync config', e);
  }
  await refreshFolderSyncStatus();
}

/** Toggle automatic runs (focus + interval). Manual "Sync now" always works. */
export async function setFolderAutoSync(configId: string, enabled: boolean): Promise<void> {
  const cfg = await folderSyncStore.get(configId);
  if (!cfg) return;
  await folderSyncStore.save({ ...cfg, auto_sync: enabled ? 1 : 0 });
  await refreshFolderSyncStatus();
}

/**
 * Scan linked directories and import changed files.
 *
 * `auto` runs (focus / interval / app open) cover every auto-enabled config
 * and are fully silent: they bail on missing auth, hidden tab or cooldown,
 * and skip a config whose permission would require a prompt. `manual` runs
 * target one config (`onlyConfigId`), may call `requestPermission()` (the
 * caller guarantees a user gesture) and ignore cooldown/toggle.
 *
 * Configs run SEQUENTIALLY under one Web Lock - parallel imports would race
 * the duplicate-title lookup and could double-create notes. A config that
 * fails (directory gone, permission lost, import error) records its own
 * error state and the loop continues with the next one.
 *
 * Returns the import result of the last config that actually imported -
 * callers that care about a specific config pass `onlyConfigId`.
 */
export async function runFolderSync(
  trigger: 'manual' | 'auto',
  onlyConfigId?: string
): Promise<ImportFolderResult | null> {
  if (!isFolderSyncSupported() || runnerActive) return null;

  const auth = get(authStore);
  if (!auth.isAuthenticated || !auth.hasE2E) return null;

  if (trigger === 'auto') {
    if (document.visibilityState !== 'visible') return null;
    if (Date.now() - lastAutoRunAt < AUTO_COOLDOWN_MS) return null;
  }

  // Claim the per-tab flag BEFORE the first await: two near-simultaneous
  // triggers (e.g. visibility + interval) must not both pass the guard.
  // The cross-tab Web Lock below covers other tabs.
  runnerActive = true;
  if (trigger === 'auto') lastAutoRunAt = Date.now();
  try {
    let configs = await readConfigs();
    if (onlyConfigId !== undefined) configs = configs.filter((c) => c.id === onlyConfigId);
    if (trigger === 'auto') configs = configs.filter((c) => c.auto_sync === 1);
    if (configs.length === 0) return null;

    return await withCrossTabLock(async () => {
      let lastResult: ImportFolderResult | null = null;
      for (const cfg of configs) {
        const result = await syncOneConfig(cfg, trigger);
        if (result !== null) lastResult = result;
      }
      return lastResult;
    });
  } finally {
    runnerActive = false;
    activeConfigId = null;
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

/**
 * Sync a single config end to end, recording its outcome in its own status
 * entry. Never throws - per-config errors must not break the runner loop.
 */
async function syncOneConfig(
  cfg: FolderSyncConfigRecord,
  trigger: 'manual' | 'auto'
): Promise<ImportFolderResult | null> {
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
    patchStatus(cfg.id, { state: 'needs-permission', progress: null });
    return null;
  }

  activeConfigId = cfg.id;
  patchStatus(cfg.id, { state: 'syncing', errorKey: null, progress: null });

  try {
    const result = await scanAndImport(cfg, handle);
    // Project the post-run record (watermark, last result, a toggle flipped
    // mid-run) into this config's status entry. No blanket refresh here -
    // it would wipe the error states other configs recorded this run.
    const latest = await folderSyncStore.get(cfg.id);
    if (latest) {
      patchStatus(cfg.id, {
        state: 'idle',
        autoSync: latest.auto_sync === 1,
        lastSyncAt: latest.last_sync_at,
        lastResult: latest.last_result,
        progress: null,
        errorKey: null
      });
    }
    return result;
  } catch (e: unknown) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotFoundError') {
      // Directory moved/deleted on disk - keep the config so the user can
      // restore the directory; surface a targeted message instead.
      logger.warn('Linked directory not found on disk', { config: cfg.root_name, error: e });
      patchStatus(cfg.id, { state: 'error', errorKey: 'folder_gone', progress: null });
    } else if (name === 'SecurityError' || name === 'NotAllowedError') {
      patchStatus(cfg.id, { state: 'needs-permission', progress: null });
    } else {
      logger.error('Folder sync failed', { config: cfg.root_name, error: e });
      patchStatus(cfg.id, { state: 'error', errorKey: 'sync_failed', progress: null });
    }
    return null;
  }
}

async function scanAndImport(
  cfg: FolderSyncConfigRecord,
  handle: FileSystemDirectoryHandle
): Promise<ImportFolderResult | null> {
  // Watermark is captured BEFORE the walk: files modified mid-scan get an
  // mtime newer than this and are re-picked next run (the unchanged-skip
  // absorbs the overlap).
  const scanStartedAt = new Date().toISOString();

  // Root the walk at the config's display name (not the on-disk name): the
  // first path segment is what importFolder turns into the top-level folder.
  const { entries, skippedTooDeep } = await collectMarkdownEntries(handle, cfg.root_name);
  if (skippedTooDeep > 0) {
    logger.warn('Folder sync: subtree(s) deeper than the depth cap were skipped', {
      skippedTooDeep
    });
  }

  // New-to-the-directory paths always import (copied/moved-in files keep
  // their old mtime and would never cross the watermark); known paths only
  // when modified since the last scan.
  const changed = filterEntriesToSync(
    entries,
    cfg.last_sync_at,
    cfg.known_paths ? new Set(cfg.known_paths) : null
  );

  let result: ImportFolderResult | null = null;
  if (changed.length > 0) {
    // Fixed `overwrite` strategy: `rename` would mint "(2)" copies on every
    // run and `skip` would never propagate disk edits. The unchanged-skip
    // inside overwrite keeps no-op refreshes free of writes and sync pushes.
    // `tagsOnOverwrite: 'merge'` is hard-coded: sync runs unattended, and
    // silently dropping tags the user added in the app (because the file's
    // frontmatter doesn't carry them) would be unrecoverable data loss.
    // Stars / pins live in metadata_encrypted and survive regardless.
    result = await importFolder(
      changed,
      'overwrite',
      (p) => patchStatus(cfg.id, { progress: p }),
      { keepRootFolder: true, tagsOnOverwrite: 'merge' }
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
    // Full snapshot of paths seen THIS scan (not a union with the previous
    // set): paths of deleted files drop out, so a file deleted and later
    // restored counts as new again and re-imports regardless of its mtime.
    known_paths: entries.map((e) => e.relativePath),
    last_result: {
      scanned: entries.length,
      imported: result?.imported ?? 0,
      unchanged: result?.duplicatesUnchanged ?? 0,
      errors: result?.errors.length ?? 0
    }
  };
  await folderSyncStore.save(updated);

  logger.info('Folder sync run complete', {
    config: cfg.root_name,
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
