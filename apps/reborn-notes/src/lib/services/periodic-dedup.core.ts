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

/** Matches the leading ISO date of a default-format periodic title. */
const ISO_PREFIX_RE = /^(\d{4}-\d{2}(?:-\d{2})?)/;

/**
 * Cheap bucket (zero crypto) for a note in a periodic folder of `kind`: only
 * notes sharing a bucket can be copies of one period, so only buckets with two
 * or more notes get their stamps decrypted. `null` = never a duplicate.
 *
 * - Titles starting with an ISO date bucket by it (`YYYY-MM-DD`; `YYYY-MM`
 *   for monthly), the date every language and every default format shares.
 * - Other titles (presets like `MMMM YYYY` or `[Week] ww, YYYY`) bucket by
 *   the exact title: copies made with the same format in the same language
 *   share it - the case where every click used to create another note.
 */
export function dedupBucketKey(title: string, kind: PeriodicKind): string | null {
  const m = ISO_PREFIX_RE.exec(title);
  if (m && (kind === 'monthly' || m[1].length === 10)) {
    return `iso:${kind === 'monthly' ? m[1].slice(0, 7) : m[1]}`;
  }
  return title.trim() === '' ? null : `title:${title}`;
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
