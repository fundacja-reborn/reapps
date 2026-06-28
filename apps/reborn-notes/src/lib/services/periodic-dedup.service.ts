/**
 * Post-sync de-duplication for Periodic Notes (Daily / Weekly / Monthly).
 *
 * Why this exists: when two devices create a periodic note for the same period
 * before either syncs, the server accepts both (their ciphertext IVs differ, so
 * there is no natural dedup). After the 2026-05-12 locale-duplicate fix,
 * `findExistingPeriodicNote` returns the newest match - the one-click flow shows
 * a single note, but both copies live in the folder list.
 *
 * Strategy (decided 2026-06-08, see planning/notes-periodic-postsync-dedup.md):
 * DETECT + MANUAL MERGE. We never mutate note content automatically after a
 * background pull - that would be a trust violation (the user didn't initiate
 * it) and the highest-risk option for the lowest-severity problem. Instead we
 * surface a confirmation modal (PeriodicDuplicatesDialog, driven by the
 * `periodicDuplicatePrompt` store); the merge runs only when the user confirms.
 * A modal, not a toast: the merge is semi-destructive (combines content, moves
 * the extra copies to Trash), and an auto-dismissing toast vanished before the
 * user could act on it (smoke #2 of PR #356).
 *
 * Detection is cheap: a title-prefix pre-filter (locale-independent ISO date -
 * the prefix both locales share, which is exactly the 2026-05-12 case) buckets
 * candidates with zero decryption. Metadata is decrypted only for actual prefix
 * collisions, and only stamped periodic notes count as duplicates, so a regular
 * note that merely starts with a date inside a periodic folder is never touched.
 */
import { get, writable } from 'svelte/store';
import type { PeriodicKind } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { toastStore } from '@reborn/ui';
import { noteIndex } from '$lib/services/note-index.svelte';
import {
  getNoteIncludingArchived,
  updateNote,
  deleteNote,
  readNoteMetadata,
  saveVersionSnapshot
} from './note.service';
import { notesStore } from '$lib/stores/notes.store';
import { getSetting } from '$lib/utils/app-settings';
import { t as i18nT, locale as i18nLocale } from '$lib/stores/i18n.store';
import {
  type DedupCandidate,
  type DedupGroup,
  buildMergedContent,
  groupDuplicates
} from './periodic-dedup.core';

const logger = createLogger('PeriodicDedup');

/** Matches the leading ISO date of a default-format periodic title. */
const ISO_PREFIX_RE = /^(\d{4}-\d{2}(?:-\d{2})?)/;

// ── i18n helpers ──────────────────────────────────────────────────

function tr(key: string, values?: Record<string, unknown>): string {
  return get(i18nT)(key, values ? { values } : undefined);
}

function formatCreatedAt(iso: string): string {
  const loc = get(i18nLocale) || 'en';
  try {
    return new Intl.DateTimeFormat(loc, { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(iso)
    );
  } catch {
    return iso;
  }
}

// ── Detection ─────────────────────────────────────────────────────

/** Map folderId -> kind for the kinds configured as periodic on this device. */
async function loadFolderKindMap(): Promise<Map<string, PeriodicKind>> {
  const map = new Map<string, PeriodicKind>();
  const settings = await getSetting('periodicNotes');
  if (!settings) return map;
  for (const kind of ['daily', 'weekly', 'monthly'] as PeriodicKind[]) {
    const fid = settings[kind]?.folderId;
    if (fid) map.set(fid, kind);
  }
  return map;
}

/** Read the periodic anchor stamp for a note, but only if its kind matches. */
async function readStampAnchor(id: string, kind: PeriodicKind): Promise<string | null> {
  const meta = await readNoteMetadata(id);
  const stamp = meta?.periodic;
  return stamp && stamp.kind === kind ? stamp.anchor : null;
}

/**
 * Scan periodic folders for duplicate notes (same folder + kind + anchor).
 * Returns groups with more than one member. Cheap unless there is an actual
 * title-prefix collision: only colliding buckets are decrypted.
 */
export async function detectPeriodicDuplicates(): Promise<DedupGroup[]> {
  if (!cryptoManager.isInitialized()) return [];

  const folderKind = await loadFolderKindMap();
  if (folderKind.size === 0) return [];

  // 1. Cheap pre-filter (no crypto): bucket active periodic-folder notes by
  //    (folderId, ISO title prefix). The ISO prefix is locale-independent, so
  //    the cross-locale duplicate pair the 2026-05-12 fix left behind lands in
  //    the same bucket.
  const buckets = new Map<
    string,
    Array<{ id: string; folderId: string; kind: PeriodicKind }>
  >();
  for (const e of noteIndex.entries()) {
    if (!e.folderId) continue;
    const kind = folderKind.get(e.folderId);
    if (!kind) continue;
    const m = ISO_PREFIX_RE.exec(e.title);
    if (!m) continue;
    // daily/weekly titles start with a full YYYY-MM-DD; monthly with YYYY-MM.
    if (kind === 'monthly') {
      if (m[1].length < 7) continue;
    } else if (m[1].length !== 10) {
      continue;
    }
    const prefix = kind === 'monthly' ? m[1].slice(0, 7) : m[1];
    const key = `${e.folderId}|${prefix}`;
    const arr = buckets.get(key);
    const entry = { id: e.id, folderId: e.folderId, kind };
    if (arr) arr.push(entry);
    else buckets.set(key, [entry]);
  }

  // 2. Confirm only collision buckets via the encrypted periodic stamp. Only
  //    stamped notes count, so a regular note that happens to start with a date
  //    in a periodic folder is never grouped (and so never merged).
  const candidates: DedupCandidate[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    for (const mem of members) {
      const anchor = await readStampAnchor(mem.id, mem.kind);
      if (!anchor) continue;
      candidates.push({
        id: mem.id,
        folderId: mem.folderId,
        kind: mem.kind,
        anchor,
        createdAt: noteIndex.get(mem.id)?.createdAt ?? ''
      });
    }
  }

  return groupDuplicates(candidates);
}

// ── Merge ─────────────────────────────────────────────────────────

function separatorFor(createdAtIso: string): string {
  const datetime = formatCreatedAt(createdAtIso);
  return `---\n*${tr('notes.periodic.dedup.merge_separator', { datetime })}*`;
}

/**
 * Merge every detected duplicate group. For each group the oldest note is kept
 * (canonical), younger copies' content is appended (with a separator), and the
 * younger copies are moved to trash. The canonical is snapshotted to version
 * history first, so the pre-merge state is recoverable.
 *
 * Re-detects at call time (does not trust a stale group list captured when the
 * toast was shown).
 */
export async function mergeAllPeriodicDuplicates(): Promise<{ groups: number; archived: number }> {
  const groups = await detectPeriodicDuplicates();
  let mergedGroups = 0;
  let archivedNotes = 0;

  for (const group of groups) {
    const [canonical, ...younger] = group.members;
    const canonicalNote = await getNoteIncludingArchived(canonical.id);
    if (!canonicalNote) continue;

    const additions: { content: string; separator: string }[] = [];
    for (const y of younger) {
      const yNote = await getNoteIncludingArchived(y.id);
      if (!yNote) continue;
      additions.push({ content: yNote.content, separator: separatorFor(y.createdAt) });
    }

    const merged = buildMergedContent(canonicalNote.content, additions);
    if (merged !== canonicalNote.content) {
      // Snapshot the pre-merge canonical so the user can roll the merge back
      // from version history - the one piece of this operation that isn't a
      // plain "restore from trash".
      await saveVersionSnapshot(canonical.id).catch((e) =>
        logger.warn('Failed to snapshot canonical before merge', e)
      );
      await updateNote(canonical.id, canonicalNote.title, merged);
    }

    for (const y of younger) {
      await deleteNote(y.id); // soft-delete -> trash (recoverable), syncs
      archivedNotes++;
    }
    mergedGroups++;
  }

  notesStore.refresh();
  return { groups: mergedGroups, archived: archivedNotes };
}

// ── Detect + notify (the post-pull hook) ──────────────────────────

/**
 * Group keys already surfaced this session. Prevents the 5-minute periodic pull
 * from re-toasting the same unresolved duplicates. Reset after a merge so a new
 * batch can be surfaced. folderId is a per-user UUID, so cross-user collision
 * across a logout/login in the same tab is effectively impossible.
 */
const notifiedKeys = new Set<string>();

/**
 * Pending duplicate-merge prompt. `PeriodicDuplicatesDialog` opens the merge
 * confirmation modal while this is non-null and reads `extra` for the count;
 * null = no prompt. A store (not a toast) because the merge is semi-destructive
 * and a deliberate decision - the old auto-dismissing toast vanished before the
 * user could act (smoke #2 of PR #356).
 */
export const periodicDuplicatePrompt = writable<{ extra: number } | null>(null);

/**
 * Detect duplicate periodic notes and, if a new batch is found, post a prompt
 * for the merge modal. Fire-and-forget from `refreshStoresAfterPull()`.
 */
export async function detectAndNotifyPeriodicDuplicates(): Promise<void> {
  // Folder-level duplicates take priority. Consolidating folders moves the notes
  // into one folder per kind (and merges the same-period copies inline), so
  // surfacing the note prompt at the same time would be redundant and confusing.
  try {
    const { detectAndNotifyPeriodicFolderDuplicates } = await import(
      '$lib/services/periodic-folder-dedup.service'
    );
    if (await detectAndNotifyPeriodicFolderDuplicates()) return;
  } catch (e) {
    logger.warn('Periodic folder duplicate scan failed', e);
  }

  const groups = await detectPeriodicDuplicates();
  if (groups.length === 0) return;

  const keys = groups.map((g) => `${g.folderId}|${g.kind}|${g.anchor}`);
  if (keys.every((k) => notifiedKeys.has(k))) return; // already surfaced this session
  for (const k of keys) notifiedKeys.add(k);

  // Count of extra copies (everything beyond the canonical in each group).
  const extra = groups.reduce((sum, g) => sum + g.members.length - 1, 0);

  periodicDuplicatePrompt.set({ extra });
}

/**
 * Dismiss the prompt without merging. `notifiedKeys` already holds this batch,
 * so it won't re-pop this session; it returns next session if the duplicates
 * are still there. Also used for an Escape / overlay close.
 */
export function dismissPeriodicDuplicatePrompt(): void {
  periodicDuplicatePrompt.set(null);
}

/**
 * Confirm the merge from the modal: run the merge, then clear the prompt (after
 * the await, so the modal keeps its processing state while the merge runs).
 * Never throws - errors surface as a toast so the modal closes cleanly.
 */
export async function confirmMergePeriodicDuplicates(): Promise<void> {
  try {
    const { archived } = await mergeAllPeriodicDuplicates();
    notifiedKeys.clear();
    if (archived > 0) {
      toastStore.success(tr('notes.periodic.dedup.merge_success', { count: archived }));
    }
  } catch (e) {
    logger.error('Periodic duplicate merge failed', e);
    toastStore.error(tr('notes.periodic.dedup.merge_error'));
  } finally {
    periodicDuplicatePrompt.set(null);
  }
}
