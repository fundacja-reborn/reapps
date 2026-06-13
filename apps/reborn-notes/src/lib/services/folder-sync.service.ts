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
 * - One-way disk → app. In-app CONTENT edits survive until the file on disk
 *   changes again; then disk wins. EXISTENCE follows disk: deleting a note in
 *   the app while its source file is still on disk re-imports it on the next
 *   run (the mirror restores it, via the file↔note manifest). To remove a
 *   synced note for good, delete the file on disk or unlink the folder.
 *   Archiving is NOT a deletion - an archived note keeps its id, so it is
 *   never re-imported.
 * - Sync NEVER deletes or trashes notes itself: a file deleted on disk leaves
 *   the note alone; a renamed file imports as a new note (the old one stays).
 * - The link to the app folder is by id (`target_folder_id`), not by name,
 *   so renaming the destination folder - in the folder tree OR in sync
 *   settings - never breaks sync: the import keeps targeting the same node.
 * - Zero Knowledge untouched: scanning, parsing and encryption all happen
 *   client-side through the same import path as a manual folder import; the
 *   directory handles never leave the browser profile.
 *
 * On browsers without the API (Safari/Firefox/native shell) the feature
 * reports unsupported and stays invisible beyond a hint in settings.
 */

import { get, writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { folderSyncStore, noteStore, type FolderSyncConfigRecord } from '@reborn/storage';
import type { FolderWithChildren } from '@reborn/types';
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
import { pushPendingItems } from './notes-sync.service';
import {
  collectMarkdownEntries,
  filterEntriesToSync,
  type SyncFileEntry
} from './folder-sync-utils';

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
 * Characters forbidden in a destination path. A forward slash "/" is now a
 * deliberate nesting separator: "Projekty/Docs" targets a folder "Docs" under
 * "Projekty" (resolved to a stable `target_folder_id` at link time). Only the
 * backslash is rejected - it reads as a Windows path separator, our folder
 * names never contain one, and allowing it would be an ambiguous second
 * separator. Empty segments (leading/trailing/doubled "/") are dropped by
 * {@link parseDestPath}, not rejected.
 */
const ILLEGAL_DEST_NAME_CHARS = /\\/;

/**
 * Split a typed destination into clean folder-name segments. Forward slashes
 * separate nesting levels; empty segments (from leading/trailing/doubled
 * slashes, e.g. "/a//b/") are dropped and each segment is trimmed. A blank or
 * slash-only string yields `[]`.
 */
function parseDestPath(raw: string): string[] {
  return raw
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Canonical "A/B/C" form of a typed destination, for storage + comparison. */
function normalizeDestPath(raw: string): string {
  return parseDestPath(raw).join('/');
}

export type FolderSyncErrorKey = 'folder_gone' | 'sync_failed' | null;

/** Reactive projection of one linked directory, for the settings UI. */
export type FolderSyncConfigStatus = {
  id: string;
  /**
   * Stored destination path / fallback label (the record's `root_name`, which
   * may be "/"-separated, e.g. "Projekty/Docs"). The settings UI prefers the
   * LIVE folder breadcrumb resolved from `targetFolderId` when the folder
   * exists, so a tree rename/move is reflected without editing.
   */
  name: string;
  /**
   * Id of the destination folder (the durable link, at any nesting level). Null
   * until the first sync (or load-time path match) resolves it; the folder UI keys its
   * "this folder is synced" marker off this, never off the name.
   */
  targetFolderId: string | null;
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
 * Map of target folder id → config id, for the folder UI to mark a folder as
 * a sync destination and offer "Sync now" on it. Keyed by id (not name) so the
 * marker follows a renamed folder and never false-matches a same-named folder;
 * callers need no extra top-level gate because the id is unique. Configs whose
 * `targetFolderId` isn't resolved yet (brand-new, pre-first-sync) are absent.
 * Empty when nothing is linked or the browser lacks the API.
 */
export const syncedFolderConfigs = derived(folderSyncStatus, ($list) => {
  const byId = new Map<string, string>();
  for (const s of $list) if (s.targetFolderId) byId.set(s.targetFolderId, s.id);
  return byId;
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
    targetFolderId: cfg.target_folder_id ?? null,
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

/** Recursively find a folder node by id in the decrypted tree. */
function findFolderInTree(nodes: FolderWithChildren[], id: string): FolderWithChildren | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const sub = n.children ? findFolderInTree(n.children, id) : null;
    if (sub) return sub;
  }
  return null;
}

/**
 * Find the folder a "/"-separated path resolves to, matching each segment
 * case-insensitively under the previous level (the tree's root array is the
 * top level). Find-only - never creates; returns null if any segment is
 * missing or `segments` is empty.
 */
function findFolderByPath(
  nodes: FolderWithChildren[],
  segments: string[]
): FolderWithChildren | null {
  let level = nodes;
  let found: FolderWithChildren | null = null;
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    const match = level.find((n) => n.name.toLowerCase() === lower) ?? null;
    if (!match) return null;
    found = match;
    level = match.children ?? [];
  }
  return found;
}

/**
 * Resolve a "/"-separated destination path to a folder id, find-or-creating
 * each missing level (case-insensitive per level, mirroring the importer's
 * `findOrCreateFolderByPath`). `segments` must be non-empty - callers validate
 * via {@link parseDestPath}. The CALLER must have refreshed `foldersStore`
 * first; a freshly created level has no children, so no re-read is needed
 * mid-walk. A single segment reproduces the old top-level-by-name behavior.
 *
 * Creates with `skipSync: true` (no immediate push). A nested path creates a
 * parent then a child in one burst, and the per-entity fire-and-forget push
 * has no parent-before-child ordering - the child's POST would race ahead of
 * its parent and the server rejects it with 404 "Parent folder not found"
 * until a retry. The deferred creates are flushed by the ordered
 * `pushPendingItems()` the subsequent `importFolder` already runs (BFS by
 * parent depth via `buildFolderLayers`), so parents land first. An empty
 * linked directory skips that import and leaves the target folder pending
 * until the next run - harmless (nothing to sync) and self-correcting.
 */
async function resolveFolderPath(segments: string[]): Promise<string> {
  let level = get(foldersStore);
  let parentId: string | undefined;
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    const existing = level.find((n) => n.name.toLowerCase() === lower);
    if (existing) {
      parentId = existing.id;
      level = existing.children ?? [];
    } else {
      // Omit the parent arg at the top level so the call shape matches the
      // optional-parentId signature (and the existing top-level create tests).
      parentId =
        parentId === undefined
          ? await foldersStore.create(seg, undefined, { skipSync: true })
          : await foldersStore.create(seg, parentId, { skipSync: true });
      level = [];
    }
  }
  return parentId as string;
}

/**
 * Resolve the app folder this config imports into, as a STABLE id (link-by-id:
 * a folder rename never breaks the link). Tries, in order:
 *   1. the persisted `target_folder_id` if that folder still exists,
 *   2/3. otherwise resolve `root_name` as a "/"-separated path, find-or-creating
 *        each level (migration from the link-by-name era, re-home when the user
 *        recreated it by name, and nesting for a multi-segment destination).
 * The resolved id is returned for the caller to persist back on the record.
 */
async function resolveTargetFolderId(cfg: FolderSyncConfigRecord): Promise<string> {
  await foldersStore.refresh();
  const tree = get(foldersStore);
  if (cfg.target_folder_id && findFolderInTree(tree, cfg.target_folder_id)) {
    return cfg.target_folder_id;
  }
  return resolveFolderPath(parseDestPath(cfg.root_name));
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
  let cfgs = await readConfigs();
  // One-time migration to link-by-id: configs from the link-by-name era (or
  // created before their first sync) carry no target_folder_id. Back-fill it
  // from a current-tree path match so the by-id marker/lookup works without a
  // sync first. Resolve-only (never create) - a missing folder/path is left for
  // the next sync's resolveTargetFolderId to create and capture. Folders are
  // only read while at least one config is unresolved, so the cost is one-time.
  if (cfgs.some((c) => !c.target_folder_id)) {
    await foldersStore.refresh();
    const tree = get(foldersStore);
    for (const cfg of cfgs) {
      if (cfg.target_folder_id) continue;
      const match = findFolderByPath(tree, parseDestPath(cfg.root_name));
      if (match) await folderSyncStore.save({ ...cfg, target_folder_id: match.id });
    }
    cfgs = await readConfigs();
  }
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
 * `displayName` is the destination, which may be a "/"-separated PATH
 * ("Projekty/Docs" → folder "Docs" under "Projekty"). It is stored normalized
 * and must be unique across configs case-insensitively, so two sources never
 * silently merge into the same folder. Colliding with an EXISTING app folder
 * (or path) is fine and deliberate: the import find-or-creates each level,
 * letting users target a folder they already have. The folder is NOT created
 * here - the caller kicks off the initial import with `runFolderSync('manual',
 * id)`, whose `resolveTargetFolderId` find-or-creates the path and captures the
 * leaf id, so the UI can close the form while the import streams progress.
 */
export async function addLinkedFolder(
  handle: FileSystemDirectoryHandle,
  displayName: string
): Promise<AddFolderOutcome> {
  if (ILLEGAL_DEST_NAME_CHARS.test(displayName)) return { ok: false, error: 'name-invalid' };
  const path = normalizeDestPath(displayName);
  if (!path) return { ok: false, error: 'name-empty' };
  const configs = await readConfigs();
  if (configs.length >= MAX_FOLDER_SYNC_CONFIGS) return { ok: false, error: 'limit-reached' };
  const pathLower = path.toLowerCase();
  if (configs.some((c) => normalizeDestPath(c.root_name).toLowerCase() === pathLower)) {
    return { ok: false, error: 'name-taken' };
  }
  const record: FolderSyncConfigRecord = {
    id: crypto.randomUUID(),
    handle,
    root_name: path,
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
  | { ok: false; error: 'name-empty' | 'name-invalid' | 'name-taken' | 'name-cycle' };

/**
 * Edit a linked folder's two user-facing names.
 *
 * - `sourceLabel` is a cosmetic, device-local annotation of the on-disk
 *   directory (see {@link FolderSyncConfigRecord.source_label}). Blank clears
 *   it (the UI then falls back to the on-disk leaf name). It never affects
 *   which directory is read - dedup is by handle identity, not by name.
 *
 * - `destName` is the destination, which may be a "/"-separated PATH. Because
 *   the link is by id (`target_folder_id`), editing it MOVES/renames the
 *   existing target folder so imported notes travel with it (see
 *   {@link moveTargetToPath}) and updates the stored `root_name`. Notes already
 *   imported stay put - they're children of the same (moved) folder. Targeting
 *   a path/name another top-level folder already uses is harmless (the import
 *   no longer find-or-creates the target by name); only cross-config path
 *   uniqueness is enforced, for a tidy settings list. The scan watermark and
 *   known-paths set are reset on a destination change so the next run
 *   reconciles under the new path root; the overwrite strategy's unchanged-skip
 *   keeps that re-scan write-free when content already matches.
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

  if (ILLEGAL_DEST_NAME_CHARS.test(changes.destName)) return { ok: false, error: 'name-invalid' };
  const newPath = normalizeDestPath(changes.destName);
  if (!newPath) return { ok: false, error: 'name-empty' };
  const newLabel = changes.sourceLabel?.trim() ? changes.sourceLabel.trim() : null;

  const oldPath = normalizeDestPath(cfg.root_name);
  const destChanged = newPath.toLowerCase() !== oldPath.toLowerCase();

  let targetId = cfg.target_folder_id;
  if (destChanged) {
    const newPathLower = newPath.toLowerCase();
    const others = (await readConfigs()).filter((c) => c.id !== configId);
    if (others.some((c) => normalizeDestPath(c.root_name).toLowerCase() === newPathLower)) {
      return { ok: false, error: 'name-taken' };
    }
    const moved = await moveTargetToPath(cfg, targetId, newPath);
    if (!moved.ok) return moved;
    targetId = moved.targetId;
  }

  const updated: FolderSyncConfigRecord = {
    ...cfg,
    source_label: newLabel,
    root_name: newPath,
    target_folder_id: targetId,
    // A changed destination invalidates the path-prefixed known set and the
    // mtime watermark; reset both so the next scan reconciles under the new
    // path root (write-free via unchanged-skip when content already matches).
    ...(destChanged ? { known_paths: undefined, last_sync_at: null } : {})
  };
  await folderSyncStore.save(updated);
  // Flush moveTargetToPath's local folder surgery as one ordered push (BFS by
  // parent depth via buildFolderLayers), so any new parent lands server-side
  // before the moved child references it. The per-entity fire-and-forget push
  // has no such ordering, which is why the child would otherwise 404. Fire-and-
  // forget like every sync push - the local move already shows in the UI.
  if (destChanged) void pushPendingItems();
  await refreshFolderSyncStatus();
  return { ok: true };
}

/**
 * Re-home this config's destination folder to a new "/"-separated path so an
 * edit MOVES the existing folder (its notes travel with it - link by id)
 * rather than orphaning them into a fresh one. Find-or-creates the new parent
 * chain, moves the target under it if the parent changed, and renames the leaf
 * if it changed. The folder to move is resolved by id, falling back to the OLD
 * path for a stale/unmigrated record; a folder that doesn't exist yet leaves
 * nothing to move (the next sync creates it under the new path). Rejected with
 * `name-cycle` if the new parent path runs through the target itself (which
 * would nest the folder in its own subtree) - detected mid-walk, before any
 * folder is created, so a rejected edit never orphans a stray folder.
 *
 * Mutates locally only (every create/move/rename uses `skipSync`); the caller
 * ({@link updateFolderSyncConfig}) fires one ordered `pushPendingItems()` so a
 * freshly-created parent lands server-side before the moved child PATCHes to
 * reference it - otherwise the child races ahead and the server answers 404
 * "Parent folder not found" until a retry.
 */
async function moveTargetToPath(
  cfg: FolderSyncConfigRecord,
  currentTargetId: string | undefined,
  newPath: string
): Promise<{ ok: true; targetId: string | undefined } | { ok: false; error: 'name-cycle' }> {
  await foldersStore.refresh();
  let tree = get(foldersStore);

  let targetId = currentTargetId;
  if (!targetId || !findFolderInTree(tree, targetId)) {
    targetId = findFolderByPath(tree, parseDestPath(cfg.root_name))?.id;
  }
  if (!targetId) return { ok: true, targetId: undefined };

  const segments = parseDestPath(newPath);
  const newLeaf = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);

  // Find-or-create the new parent chain, walking top-down. Bail with
  // `name-cycle` BEFORE any creation the moment the chain reaches the target:
  // anything below it would nest the folder inside its own subtree, and bailing
  // first avoids leaving an orphaned folder created under the target.
  let parentId: string | undefined = undefined;
  let level: FolderWithChildren[] = tree;
  for (const seg of parentSegments) {
    if (parentId === targetId) return { ok: false, error: 'name-cycle' };
    const lower = seg.toLowerCase();
    const existing = level.find((n) => n.name.toLowerCase() === lower);
    if (existing) {
      parentId = existing.id;
      level = existing.children ?? [];
    } else {
      // skipSync on every mutation here: the caller flushes one ordered
      // pushPendingItems() so the new parent chain lands before the moved
      // child references it (see resolveFolderPath + updateFolderSyncConfig).
      parentId =
        parentId === undefined
          ? await foldersStore.create(seg, undefined, { skipSync: true })
          : await foldersStore.create(seg, parentId, { skipSync: true });
      level = [];
    }
  }
  if (parentId === targetId) return { ok: false, error: 'name-cycle' };
  const newParentId = parentId;

  // Re-read: creating parent folders above may have changed the tree.
  await foldersStore.refresh();
  tree = get(foldersStore);
  const node = findFolderInTree(tree, targetId);
  if (!node) return { ok: true, targetId };

  if ((newParentId ?? undefined) !== (node.parent_id ?? undefined)) {
    await foldersStore.move(targetId, newParentId ?? null, { skipSync: true });
  }
  if (node.name !== newLeaf) await foldersStore.rename(targetId, newLeaf, { skipSync: true });
  return { ok: true, targetId };
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
        targetFolderId: latest.target_folder_id ?? null,
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

/**
 * Ids of every note currently in local storage - the source of truth for
 * "does this note still exist". Reads the raw encrypted records and keeps only
 * the plaintext `id` (no decryption), so it is cheap to call each run. Archived
 * notes are included (their record stays in the store), so only a hard delete /
 * emptied trash drops an id - exactly when a synced file's note must come back.
 */
async function liveNoteIds(): Promise<Set<string>> {
  const all = await noteStore.getAll();
  return new Set(all.map((n) => n.id));
}

/**
 * Build the next file↔note manifest from this run: the freshly-imported id for
 * each path the import touched, the carried-over id for paths skipped as
 * unchanged, and nothing for paths gone from disk (only current `entries` are
 * walked). `prev` is undefined on the first manifest-populating run.
 */
function buildNextManifest(
  entries: SyncFileEntry[],
  imported: ImportFolderResult | null,
  prev: Record<string, string> | undefined
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const e of entries) {
    const id = imported?.pathToNoteId[e.relativePath] ?? prev?.[e.relativePath];
    if (id !== undefined) next[e.relativePath] = id;
  }
  return next;
}

async function scanAndImport(
  cfg: FolderSyncConfigRecord,
  handle: FileSystemDirectoryHandle
): Promise<ImportFolderResult | null> {
  // Watermark is captured BEFORE the walk: files modified mid-scan get an
  // mtime newer than this and are re-picked next run (the unchanged-skip
  // absorbs the overlap).
  const scanStartedAt = new Date().toISOString();

  // Root the walk's relative paths at the on-disk dir name (handle.name),
  // decoupled from root_name now that root_name can be a "/"-separated
  // destination PATH (a multi-segment root would leak extra levels through
  // extractFolderSegments). importFolder strips this single first segment
  // (keepRootFolder defaults off) and anchors the subtree under
  // `targetFolderId`. handle.name is stable across tree renames so known_paths
  // don't churn; it only shifts if the on-disk directory itself is renamed (a
  // one-off, write-free re-reconcile via the overwrite strategy's unchanged-skip).
  const { entries, skippedTooDeep } = await collectMarkdownEntries(handle);
  if (skippedTooDeep > 0) {
    logger.warn('Folder sync: subtree(s) deeper than the depth cap were skipped', {
      skippedTooDeep
    });
  }

  // Resolve the destination folder by id (link-by-id): rename-proof, and
  // migrates/recreates as needed. Done AFTER the walk so a directory that's
  // gone on disk fails fast without first creating an app folder for it.
  const targetFolderId = await resolveTargetFolderId(cfg);

  // New-to-the-directory paths always import (copied/moved-in files keep
  // their old mtime and would never cross the watermark); known paths only
  // when modified since the last scan.
  const incremental = filterEntriesToSync(
    entries,
    cfg.last_sync_at,
    cfg.known_paths ? new Set(cfg.known_paths) : null
  );

  // The incremental filter is blind to IN-APP deletions: deleting a note (or
  // emptying it from the trash) leaves its source file untouched on disk, so
  // the mtime + known-path skip would never re-import it - yet a one-way
  // disk→app mirror should restore it. Cross-check the file↔note manifest
  // against the notes that still exist and force-import any file whose note is
  // gone. Archived notes keep their id, so archiving is not a deletion.
  const prevManifest = cfg.path_note_ids;
  let changed = incremental;
  if (prevManifest === undefined) {
    // Record from before the manifest existed (link-by-name era / pre-first-
    // sync): reconcile every file once to populate it. Cheap - the overwrite
    // strategy's unchanged-skip makes the one-off full pass write-free.
    changed = entries;
  } else {
    const liveIds = await liveNoteIds();
    const included = new Set(incremental.map((e) => e.relativePath));
    const reimportDeleted = entries.filter((e) => {
      if (included.has(e.relativePath)) return false;
      const mappedId = prevManifest[e.relativePath];
      return mappedId !== undefined && !liveIds.has(mappedId);
    });
    if (reimportDeleted.length > 0) changed = [...incremental, ...reimportDeleted];
  }

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
      { targetFolderId, tagsOnOverwrite: 'merge' }
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
    // Persist the resolved link so future runs and the folder marker use the
    // id (migrates a link-by-name record on its first run under this code).
    target_folder_id: targetFolderId,
    last_sync_at: scanStartedAt,
    // Full snapshot of paths seen THIS scan (not a union with the previous
    // set): paths of deleted files drop out, so a file deleted and later
    // restored counts as new again and re-imports regardless of its mtime.
    known_paths: entries.map((e) => e.relativePath),
    // File↔note manifest for the next run's in-app-deletion check: fresh id
    // for paths imported now, carried-over id for paths skipped as unchanged,
    // and on-disk-gone paths dropped (only current `entries` are mapped).
    path_note_ids: buildNextManifest(entries, result, prevManifest),
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
