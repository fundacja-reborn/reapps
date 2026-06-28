/**
 * Pure helpers for Periodic Notes *folder* de-duplication.
 *
 * Companion to `periodic-dedup.core.ts` (which dedups duplicate NOTES inside one
 * folder). This file dedups duplicate periodic FOLDERS: the 2026-06-28 sync-race
 * bug let `ensureFolder` mint a fresh "Daily Notes" folder every time a periodic
 * button was clicked during the cold-login pull (the real folder wasn't in the
 * in-memory store yet), so an account could accumulate a dozen identically-named
 * periodic folders, each holding a stray note.
 *
 * Kept free of `$lib` / svelte / `@reborn/ui` imports (type-only dependency on
 * `@reborn/storage`) so it is unit-testable in the plain Node vitest env. The
 * orchestration (decryption, stores, folder/note moves) lives in
 * `periodic-folder-dedup.service.ts`.
 */
import type { PeriodicKind } from '@reborn/storage';

const KINDS: PeriodicKind[] = ['daily', 'weekly', 'monthly'];

/** A root folder, as seen by the folder-dedup classifier. */
export interface FolderInfo {
  id: string;
  name: string;
  /** `null`/`undefined` for a root-level folder. */
  parentId: string | null | undefined;
  createdAt: string;
  /** Active (non-trashed) notes currently in this folder. */
  noteCount: number;
  /** Kinds for which this folder holds >=1 note carrying a periodic stamp. */
  stampedKinds: PeriodicKind[];
}

/** Inputs that disambiguate which folders count as periodic for a kind. */
export interface PeriodicFolderContext {
  /** Default folder names per kind, across every supported locale (exact match). */
  defaultNamesByKind: Record<PeriodicKind, Set<string>>;
  /** The folder currently configured as periodic per kind (local settings). */
  settingsFolderIdByKind: Partial<Record<PeriodicKind, string>>;
}

/** One candidate folder within a kind's duplicate group. */
export interface FolderDedupCandidate {
  id: string;
  createdAt: string;
  noteCount: number;
  /** True when the folder holds >=1 note stamped with this group's kind. */
  hasStampedNotes: boolean;
}

export interface FolderDedupGroup {
  kind: PeriodicKind;
  /** The folder to keep: most notes, oldest on a tie. */
  canonicalId: string;
  /** Folders whose notes move into the canonical and which are then removed. */
  duplicateIds: string[];
  /** Total folders in the group (canonical + duplicates). */
  folderCount: number;
  /** Notes that will be moved out of the duplicate folders into the canonical. */
  notesToMove: number;
}

/**
 * Order candidates so the BEST keep-folder is first:
 *   1. one that actually holds this kind's stamped notes (not an empty shell),
 *   2. then the one with the most notes (minimises moving),
 *   3. then the oldest (stable "original"),
 *   4. then id, for determinism.
 */
export function orderCanonicalFirst(candidates: FolderDedupCandidate[]): FolderDedupCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.hasStampedNotes !== b.hasStampedNotes) return a.hasStampedNotes ? -1 : 1;
    if (a.noteCount !== b.noteCount) return b.noteCount - a.noteCount;
    const t = (a.createdAt || '').localeCompare(b.createdAt || '');
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
}

/** Build a group from a kind's candidates, or null if there's nothing to merge. */
export function buildFolderDedupGroup(
  kind: PeriodicKind,
  candidates: FolderDedupCandidate[]
): FolderDedupGroup | null {
  if (candidates.length < 2) return null;
  const [canonical, ...duplicates] = orderCanonicalFirst(candidates);
  return {
    kind,
    canonicalId: canonical.id,
    duplicateIds: duplicates.map((d) => d.id),
    folderCount: candidates.length,
    notesToMove: duplicates.reduce((sum, d) => sum + d.noteCount, 0)
  };
}

/**
 * Classify root folders into duplicate periodic-folder groups.
 *
 * A folder counts as a periodic folder for kind K when it is ROOT-LEVEL and any of:
 *   - it holds >=1 note stamped with kind K (definitive, locale-independent), OR
 *   - it is the folder currently configured as K in local settings, OR
 *   - it is EMPTY of periodic notes AND its name equals a default K name in some
 *     locale (the only way to catch the bug's empty duplicate shells without
 *     grabbing a user's populated unrelated folder).
 *
 * Guards that keep this safe:
 *   - Folders carrying MORE THAN ONE periodic kind are skipped entirely (ambiguous).
 *   - A name match never claims a folder that holds another kind's notes.
 *   - A group forms only if >=1 member is *confirmed* periodic (stamped or the
 *     settings folder) - so folders that merely share a default name, with no
 *     periodic linkage at all, are left untouched.
 */
export function detectFolderDuplicateGroups(
  folders: FolderInfo[],
  ctx: PeriodicFolderContext
): FolderDedupGroup[] {
  const groups: FolderDedupGroup[] = [];

  for (const kind of KINDS) {
    const names = ctx.defaultNamesByKind[kind] ?? new Set<string>();
    const settingsId = ctx.settingsFolderIdByKind[kind];
    const candidates: FolderDedupCandidate[] = [];

    for (const f of folders) {
      if (f.parentId) continue; // the bug only mints root folders
      if (f.stampedKinds.length > 1) continue; // mixed kinds: ambiguous, leave alone

      const stampedThisKind = f.stampedKinds.includes(kind);
      const stampedOtherKind = f.stampedKinds.length > 0 && !stampedThisKind;
      if (stampedOtherKind) continue; // belongs to a different kind

      const isCandidate =
        stampedThisKind ||
        f.id === settingsId ||
        (names.has(f.name) && f.stampedKinds.length === 0);
      if (!isCandidate) continue;

      candidates.push({
        id: f.id,
        createdAt: f.createdAt,
        noteCount: f.noteCount,
        hasStampedNotes: stampedThisKind
      });
    }

    const group = buildFolderDedupGroup(kind, candidates);
    if (!group) continue;
    // Only act when at least one member is unambiguously a periodic folder.
    const confirmed = candidates.some((c) => c.hasStampedNotes || c.id === settingsId);
    if (!confirmed) continue;
    groups.push(group);
  }

  return groups;
}
