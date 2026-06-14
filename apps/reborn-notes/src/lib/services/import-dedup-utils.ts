/**
 * Pure helpers for deduplicating notes during folder/file import.
 *
 * No side effects, no IndexedDB access. The folder import callsite passes in
 * a snapshot of `(folder_id, lowercase title)` pairs (built from `noteIndex`)
 * and mutates the lookup as the batch progresses, so files within the same
 * import respect each other (e.g. a vault containing two `Notes.md` in the
 * same directory will produce `Notes.md` and `Notes (2).md`).
 */

export type DuplicateStrategy = 'skip' | 'overwrite' | 'rename';

/**
 * How the `overwrite` strategy treats the existing note's tags when the
 * import path manages tags (folder import with frontmatter resolution):
 *
 * - `replace` - frontmatter is the source of truth: the note's tag set
 *   becomes exactly the file's tags (tags added in the app are dropped).
 * - `merge`   - frontmatter tags are UNIONED into the note's existing tags:
 *   in-app curation survives re-imports and live folder sync. The trade-off
 *   is that removing a tag from frontmatter never removes it from the note -
 *   remove it in the app instead.
 *
 * Stars / pins / other `metadata_encrypted` fields are never touched by
 * overwrite in either mode (`updateNote` only rewrites title + content).
 */
export type TagOverwriteMode = 'replace' | 'merge';

/**
 * Filename length cap for sanitized titles (mirrors `sanitizeFilename` in
 * export-import.service.ts). The rename suffix `" (N)"` must fit within this
 * cap, so the base title is trimmed to leave room before appending the suffix.
 */
export const MAX_TITLE_LENGTH = 100;

/** Sentinel key for the unfiled root (notes with no `folder_id`). */
export const ROOT_FOLDER_KEY = '__root__';

/** Build a lookup key from a folder id (or undefined for the root level). */
export function folderKey(folderId: string | undefined | null): string {
  return folderId ?? ROOT_FOLDER_KEY;
}

/**
 * Per-folder lookup of taken note titles for duplicate detection.
 *
 * Map<folderKey, Map<lowerTitle, noteId>>. Lowercase keys ensure case-insensitive
 * matching ("Notes.md" collides with "notes.md", consistent with how folders
 * and tags are deduplicated elsewhere in the importer).
 */
export type TitleLookup = Map<string, Map<string, string>>;

/** Insert / overwrite an entry in the title lookup. */
export function rememberTitle(
  lookup: TitleLookup,
  folderId: string | undefined,
  title: string,
  noteId: string
): void {
  const key = folderKey(folderId);
  let bucket = lookup.get(key);
  if (!bucket) {
    bucket = new Map();
    lookup.set(key, bucket);
  }
  bucket.set(title.toLowerCase(), noteId);
}

/** Look up an existing note id by (folder, title). */
export function findExisting(
  lookup: TitleLookup,
  folderId: string | undefined,
  title: string
): string | undefined {
  return lookup.get(folderKey(folderId))?.get(title.toLowerCase());
}

/**
 * Pick the existing note an imported file should overwrite, preferring the
 * durable path→note manifest over the volatile in-memory title index.
 *
 * Live folder sync persists a `relativePath → note id` manifest in IndexedDB
 * (`path_note_ids`). When a file is already linked to a still-live note that
 * link is AUTHORITATIVE: the file overwrites THAT note regardless of the title
 * lookup. The lookup is built from the per-tab, RAM-only `noteIndex`, which can
 * be stale (e.g. a note imported in another tab the current context hasn't
 * pulled yet) - trusting it alone minted a duplicate note on the next sync
 * (`findExisting` missed → a second copy was created). Falling back to the
 * title lookup only when the manifest has no usable entry keeps manual imports
 * (no manifest) and brand-new files on the original case-insensitive matching.
 *
 * `manifest.live` is the caller's confirmation that `manifest.noteId` still
 * exists AND is active (`NoteService.getNote` returns null for missing/trashed
 * notes); a stale id pointing at a deleted note therefore falls through to the
 * title lookup, which re-creates it - the one-way mirror's "disk wins" intent.
 */
export function pickOverwriteTarget(
  manifest: { noteId: string | undefined; live: boolean },
  lookup: TitleLookup,
  folderId: string | undefined,
  title: string
): string | undefined {
  if (manifest.noteId !== undefined && manifest.live) return manifest.noteId;
  return findExisting(lookup, folderId, title);
}

/**
 * Decide whether an `overwrite`-strategy import can skip the write entirely
 * because the incoming file is identical to the already-stored note.
 *
 * Comparison is exact (case-sensitive) on title and content - a deliberate
 * asymmetry with the case-INsensitive duplicate *detection*: "notes.md" is
 * matched against an existing "Notes.md" (so it doesn't duplicate), but the
 * title-case change still counts as a real update.
 *
 * `incoming.tagIds === undefined` means the import path does not manage tags
 * (flat .md import) - tags are then excluded from the comparison, mirroring
 * the overwrite behavior of leaving them untouched. When provided (folder
 * import), the tag comparison follows `tagMode`:
 *
 * - `replace`: tag sets must be equal (a dropped frontmatter tag is a change).
 * - `merge`:   incoming tags must be a SUBSET of the existing set - merging
 *   would add nothing, so extra in-app tags do not count as a difference.
 */
export function isImportUnchanged(
  existing: { title: string; content: string; tagIds: string[] },
  incoming: { title: string; content: string; tagIds?: string[] },
  tagMode: TagOverwriteMode = 'replace'
): boolean {
  if (existing.title !== incoming.title) return false;
  if (existing.content !== incoming.content) return false;
  if (incoming.tagIds === undefined) return true;
  // Set semantics on both sides - frontmatter can repeat a tag (`tags: [a, a]`)
  // and setTagsForNote would collapse it anyway, so duplicates must not count.
  const existingSet = new Set(existing.tagIds);
  const incomingSet = new Set(incoming.tagIds);
  if (tagMode === 'merge') {
    for (const id of incomingSet) {
      if (!existingSet.has(id)) return false;
    }
    return true;
  }
  if (existingSet.size !== incomingSet.size) return false;
  for (const id of incomingSet) {
    if (!existingSet.has(id)) return false;
  }
  return true;
}

/**
 * Union of existing + incoming tag ids, de-duplicated, existing order first.
 * Used by the `merge` tag mode to compute the final tag set on overwrite.
 */
export function mergeTagIds(existing: string[], incoming: string[]): string[] {
  const out = [...new Set(existing)];
  const seen = new Set(out);
  for (const id of incoming) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Order-insensitive tag set equality (duplicates collapse). */
export function tagSetsEqual(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const id of setB) {
    if (!setA.has(id)) return false;
  }
  return true;
}

/**
 * Compute a non-colliding renamed title by appending ` (N)` until the slot
 * is free. Trims the base title so that the longest possible suffix
 * (` (999)` ≈ 6 chars; bounded at 9999 here for safety) still fits within
 * {@link MAX_TITLE_LENGTH}.
 *
 * The `taken` parameter accepts pre-lowercased titles (matches the lookup
 * convention). We bound the loop at 9999 to avoid pathological infinite
 * loops on a fully-saturated namespace; practically unreachable.
 */
export function computeRenamedTitle(
  baseTitle: string,
  taken: ReadonlySet<string>
): string {
  const trimmedBase = baseTitle.trim() || 'Untitled';

  // Reserve room for the suffix. Max suffix is " (9999)" = 7 chars.
  const SUFFIX_RESERVE = 7;
  const truncatedBase =
    trimmedBase.length > MAX_TITLE_LENGTH - SUFFIX_RESERVE
      ? trimmedBase.slice(0, MAX_TITLE_LENGTH - SUFFIX_RESERVE).trimEnd()
      : trimmedBase;

  // Bounded counter — practically unreachable, but defends against pathological
  // inputs (e.g. a namespace deliberately filled with collisions).
  for (let n = 2; n <= 9999; n++) {
    const candidate = `${truncatedBase} (${n})`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  // Fallback: the practically-impossible saturated case — append a short
  // random suffix to escape the collision space.
  return `${truncatedBase} (${Math.random().toString(36).slice(2, 8)})`;
}
