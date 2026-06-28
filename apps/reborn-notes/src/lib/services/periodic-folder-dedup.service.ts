/**
 * Post-sync de-duplication for Periodic Notes *folders* (Daily / Weekly / Monthly).
 *
 * Why this exists: the 2026-06-28 sync-race bug let `getOrCreateNote` run
 * `ensureFolder` against an EMPTY in-memory `foldersStore` during the cold-login
 * pull, so every periodic-button click mid-sync minted a fresh "Daily Notes"
 * folder (the real one wasn't in memory yet) and stamped it as the active
 * periodic folder. Accounts that hit it accumulated a dozen identically-named
 * periodic folders, each holding a stray note - which also hid the copies from
 * the note-level dedup (it groups by folderId). The resolver fix in
 * `periodic-notes.service` stops new duplicates; this consolidates the ones that
 * already exist.
 *
 * Strategy (mirrors note dedup): DETECT + CONFIRM + MERGE. We never restructure
 * folders silently after a background pull - the merge moves notes between
 * folders, deletes the empty shells, and merges the now-colocated same-period
 * notes, so it runs only when the user confirms a modal
 * (`PeriodicFolderDuplicatesDialog`, driven by `periodicFolderDuplicatePrompt`).
 *
 * Reversibility: notes are MOVED, never deleted, so nothing of the user's content
 * is lost; the same-period note merge snapshots each canonical to version history
 * and sends the extra copies to Trash (the existing note-dedup guarantees). Only
 * the now-empty duplicate folder shells are removed for good - they hold no notes.
 *
 * Detection is cheap: note counts come from the plaintext in-memory index, and
 * only ISO-prefix-titled notes are decrypted (to read their periodic stamp), the
 * same pre-filter the note dedup uses.
 */
import { get, writable } from 'svelte/store';
import { PERIODIC_NOTES_DEFAULTS, type PeriodicKind } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { toastStore } from '@reborn/ui';
import { noteIndex } from '$lib/services/note-index.svelte';
import { readNoteMetadata, moveNoteToFolder } from './note.service';
import { foldersStore } from '$lib/stores/folders.store';
import { notesStore } from '$lib/stores/notes.store';
import { getSetting } from '$lib/utils/app-settings';
import { appSettings } from '$lib/stores/app-settings.store';
import { t as i18nT } from '$lib/stores/i18n.store';
import {
  detectFolderDuplicateGroups,
  type FolderInfo,
  type FolderDedupGroup
} from './periodic-folder-dedup.core';

const logger = createLogger('PeriodicFolderDedup');

const KINDS: PeriodicKind[] = ['daily', 'weekly', 'monthly'];

/** Matches the leading ISO date of a default-format periodic title. */
const ISO_PREFIX_RE = /^(\d{4}-\d{2}(?:-\d{2})?)/;

function tr(key: string, values?: Record<string, unknown>): string {
  return get(i18nT)(key, values ? { values } : undefined);
}

function emptyKindSets(): Record<PeriodicKind, Set<string>> {
  return { daily: new Set(), weekly: new Set(), monthly: new Set() };
}

// ── Detection ─────────────────────────────────────────────────────

/**
 * Build a `FolderInfo` per ROOT folder plus the set of folder names that
 * actually hold each kind's stamped notes. The name set makes empty-shell
 * matching locale-independent: an empty "Daily Notes" shell is recognised by the
 * name a *real* daily folder uses, whatever the current UI locale.
 */
async function buildFolderInfos(): Promise<{
  infos: FolderInfo[];
  stampedNamesByKind: Record<PeriodicKind, Set<string>>;
}> {
  const rootFolders = get(foldersStore); // tree top level = root folders
  const rootNameById = new Map(rootFolders.map((f) => [f.id, f.name]));

  // Active note counts per folder (plaintext index, zero crypto).
  const noteCountByFolder = new Map<string, number>();
  for (const e of noteIndex.entries()) {
    if (!e.folderId) continue;
    noteCountByFolder.set(e.folderId, (noteCountByFolder.get(e.folderId) ?? 0) + 1);
  }

  // Stamped kinds per folder: decrypt only ISO-prefix-titled notes.
  const stampedKindsByFolder = new Map<string, Set<PeriodicKind>>();
  const stampedNamesByKind = emptyKindSets();
  for (const e of noteIndex.entries()) {
    if (!e.folderId) continue;
    if (!ISO_PREFIX_RE.test(e.title)) continue;
    const meta = await readNoteMetadata(e.id);
    const stamp = meta?.periodic;
    if (!stamp) continue;
    let set = stampedKindsByFolder.get(e.folderId);
    if (!set) {
      set = new Set();
      stampedKindsByFolder.set(e.folderId, set);
    }
    set.add(stamp.kind);
    const name = rootNameById.get(e.folderId);
    if (name) stampedNamesByKind[stamp.kind].add(name);
  }

  const infos: FolderInfo[] = rootFolders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parent_id ?? null,
    createdAt: f.created_at,
    noteCount: noteCountByFolder.get(f.id) ?? 0,
    stampedKinds: Array.from(stampedKindsByFolder.get(f.id) ?? [])
  }));

  return { infos, stampedNamesByKind };
}

/**
 * Scan root folders for duplicate periodic folders (same kind). Returns one
 * group per affected kind, or [] when there's nothing to consolidate.
 */
export async function detectPeriodicFolderDuplicates(): Promise<FolderDedupGroup[]> {
  if (!cryptoManager.isInitialized()) return [];

  // Cheap gate (zero crypto): the bug's signature is >=2 ROOT folders sharing a
  // name. If no root name repeats there are no duplicate periodic folders to find,
  // so skip the decrypting stamp scan entirely - this keeps the per-pull cost at
  // O(folders) string ops for the overwhelming majority of accounts. (Differently-
  // named same-kind folders across locales are intentionally left alone: they may
  // be deliberate, and merging them would be a surprise.)
  const rootNameCounts = new Map<string, number>();
  for (const f of get(foldersStore)) {
    rootNameCounts.set(f.name, (rootNameCounts.get(f.name) ?? 0) + 1);
  }
  if (![...rootNameCounts.values()].some((n) => n >= 2)) return [];

  const { infos, stampedNamesByKind } = await buildFolderInfos();

  const settings = await getSetting('periodicNotes');
  const settingsFolderIdByKind: Partial<Record<PeriodicKind, string>> = {};
  if (settings) {
    for (const k of KINDS) {
      const fid = settings[k]?.folderId;
      if (fid) settingsFolderIdByKind[k] = fid;
    }
  }

  // Names that identify an empty shell as belonging to a kind: the current-locale
  // default plus every name a real (stamped) folder of that kind uses.
  const defaultNamesByKind = emptyKindSets();
  for (const k of KINDS) {
    const set = new Set<string>(stampedNamesByKind[k]);
    const def = tr(`notes.periodic.${k}.folder.default`);
    if (def) set.add(def);
    defaultNamesByKind[k] = set;
  }

  return detectFolderDuplicateGroups(infos, { defaultNamesByKind, settingsFolderIdByKind });
}

// ── Merge ─────────────────────────────────────────────────────────

/** Re-point local settings for `kind` at the canonical folder (idempotent). */
async function repointSettings(kind: PeriodicKind, folderId: string): Promise<void> {
  const current = (await getSetting('periodicNotes')) ?? PERIODIC_NOTES_DEFAULTS;
  if (current[kind]?.folderId === folderId) return;
  const next = {
    ...current,
    [kind]: { ...current[kind], folderId }
  };
  await appSettings.update('periodicNotes', next);
}

/**
 * Consolidate every detected duplicate folder group: move each duplicate's notes
 * into the canonical folder, re-point local settings at the canonical, then
 * delete the (now-empty) duplicate folders. Re-detects at call time so it never
 * acts on a stale group list.
 *
 * Does NOT merge the colocated same-period notes - that is the note dedup's job,
 * chained by the caller after this returns.
 */
export async function mergePeriodicFolderDuplicates(): Promise<{
  groups: number;
  foldersRemoved: number;
  notesMoved: number;
}> {
  const groups = await detectPeriodicFolderDuplicates();
  let mergedGroups = 0;
  let foldersRemoved = 0;
  let notesMoved = 0;

  const { deleteFolder } = await import('./folder.service');

  for (const group of groups) {
    // Move every note out of the duplicate folders into the canonical.
    for (const dupId of group.duplicateIds) {
      const noteIds = noteIndex
        .entries()
        .filter((e) => e.folderId === dupId)
        .map((e) => e.id);
      for (const id of noteIds) {
        await moveNoteToFolder(id, group.canonicalId);
        notesMoved++;
      }
    }

    // Point local settings at the survivor BEFORE deleting shells, so a failure
    // mid-delete still leaves the canonical configured.
    await repointSettings(group.kind, group.canonicalId);

    // Remove the now-empty duplicate folders (no notes left to detach).
    for (const dupId of group.duplicateIds) {
      try {
        await deleteFolder(dupId, 'detach');
        foldersRemoved++;
      } catch (e) {
        logger.warn('Failed to remove duplicate periodic folder', { id: dupId, error: e });
      }
    }
    mergedGroups++;
  }

  await foldersStore.refresh();
  await noteIndex.rebuild();
  notesStore.refresh();

  return { groups: mergedGroups, foldersRemoved, notesMoved };
}

// ── Detect + notify (the post-pull hook) ──────────────────────────

/**
 * Group keys already surfaced this session, so a periodic background pull does
 * not re-pop the same unresolved folder duplicates. Reset after a merge.
 */
const notifiedFolderKeys = new Set<string>();

/**
 * Pending folder-consolidation prompt. `PeriodicFolderDuplicatesDialog` opens
 * while this is non-null; null = no prompt. `folders` = extra folders to remove,
 * `notes` = notes that will be moved.
 */
export const periodicFolderDuplicatePrompt = writable<{
  folders: number;
  notes: number;
} | null>(null);

/**
 * Detect duplicate periodic folders and, if a new batch is found, post the
 * consolidation prompt. Returns true when a prompt was posted, so the note-level
 * scan can defer (folder consolidation colocates the notes first).
 */
export async function detectAndNotifyPeriodicFolderDuplicates(): Promise<boolean> {
  const groups = await detectPeriodicFolderDuplicates();
  if (groups.length === 0) return false;

  const keys = groups.map((g) => `${g.kind}|${g.canonicalId}|${[...g.duplicateIds].sort().join(',')}`);
  if (keys.every((k) => notifiedFolderKeys.has(k))) return false; // already surfaced this session
  for (const k of keys) notifiedFolderKeys.add(k);

  const folders = groups.reduce((sum, g) => sum + g.duplicateIds.length, 0);
  const notes = groups.reduce((sum, g) => sum + g.notesToMove, 0);
  periodicFolderDuplicatePrompt.set({ folders, notes });
  return true;
}

/** Dismiss without consolidating; the batch returns next session if still present. */
export function dismissPeriodicFolderDuplicatePrompt(): void {
  periodicFolderDuplicatePrompt.set(null);
}

/**
 * Confirm consolidation from the modal: move notes + remove empty shells, then
 * merge the now-colocated same-period notes via the existing note dedup. Never
 * throws - errors surface as a toast so the modal closes cleanly.
 */
export async function confirmMergePeriodicFolderDuplicates(): Promise<void> {
  try {
    const { foldersRemoved } = await mergePeriodicFolderDuplicates();
    notifiedFolderKeys.clear();

    // Same-period notes are now in one folder per kind; merge them (snapshots +
    // Trash, reversible). Runs inline so the whole tidy-up is one confirmation.
    const { mergeAllPeriodicDuplicates } = await import('./periodic-dedup.service');
    await mergeAllPeriodicDuplicates();

    if (foldersRemoved > 0) {
      toastStore.success(tr('notes.periodic.folder_dedup.merge_success', { count: foldersRemoved }));
    }
  } catch (e) {
    logger.error('Periodic folder duplicate merge failed', e);
    toastStore.error(tr('notes.periodic.folder_dedup.merge_error'));
  } finally {
    periodicFolderDuplicatePrompt.set(null);
  }
}
