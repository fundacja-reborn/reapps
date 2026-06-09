/**
 * Pure helpers for Periodic Notes post-sync de-duplication.
 *
 * Kept free of `$lib` / svelte / `@reborn/ui` imports (type-only dependency on
 * `@reborn/storage`) so it is unit-testable in the plain Node vitest env, the
 * same split as `periodic-notes-format.ts` vs `periodic-notes.service.ts`.
 * Orchestration (decryption, stores, toast) lives in `periodic-dedup.service.ts`.
 */
import type { PeriodicKind } from '@reborn/storage';

export interface DedupCandidate {
  id: string;
  folderId: string;
  kind: PeriodicKind;
  anchor: string;
  createdAt: string;
}

export interface DedupGroup {
  folderId: string;
  kind: PeriodicKind;
  anchor: string;
  /** Members sorted by createdAt ascending; `members[0]` is the canonical (oldest). */
  members: DedupCandidate[];
}

/**
 * Group confirmed periodic notes by `(folderId, kind, anchor)` and return only
 * groups with more than one member. Each group's members are sorted oldest-first
 * (by `createdAt`, tie-broken by `id` for determinism) so `members[0]` is the
 * canonical note to keep.
 */
export function groupDuplicates(candidates: DedupCandidate[]): DedupGroup[] {
  const buckets = new Map<string, DedupCandidate[]>();
  for (const c of candidates) {
    const key = `${c.folderId}|${c.kind}|${c.anchor}`;
    const arr = buckets.get(key);
    if (arr) arr.push(c);
    else buckets.set(key, [c]);
  }

  const groups: DedupGroup[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => {
      const t = a.createdAt.localeCompare(b.createdAt);
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });
    groups.push({
      folderId: members[0].folderId,
      kind: members[0].kind,
      anchor: members[0].anchor,
      members
    });
  }
  return groups;
}

/**
 * Build merged note content: the canonical body, then each non-empty younger
 * body prefixed with its separator. Empty younger copies (title only, no body)
 * contribute nothing - they are merely archived, with no stray separator.
 */
export function buildMergedContent(
  canonicalContent: string,
  additions: { content: string; separator: string }[]
): string {
  let acc = canonicalContent.replace(/\s+$/, '');
  for (const a of additions) {
    if (a.content.trim() === '') continue;
    const block = `${a.separator}\n\n${a.content.replace(/\s+$/, '')}`;
    acc = acc.trim() === '' ? block : `${acc}\n\n${block}`;
  }
  return acc;
}
