/**
 * Pure helpers for the note-to-note link graph. Kept free of runes / crypto /
 * storage so the link-extraction logic (the bug-prone, Zero-Knowledge-sensitive
 * part - it must never over-match) is trivially unit-testable.
 */

/** Capture the target UUID of every `[label](note:UUID)` markdown link. */
const NOTE_LINK_TARGET_RE =
  /\]\(note:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

/**
 * Extract the set of note ids that `content` links to via the `note:` scheme,
 * lowercased and excluding `selfId` (a note is never its own backlink).
 */
export function extractNoteLinkTargets(content: string, selfId?: string): Set<string> {
  const targets = new Set<string>();
  if (!content) return targets;
  const self = selfId?.toLowerCase();
  NOTE_LINK_TARGET_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NOTE_LINK_TARGET_RE.exec(content)) !== null) {
    const target = match[1].toLowerCase();
    if (target !== self) targets.add(target);
  }
  return targets;
}

/**
 * Ids present in BOTH lists - the mutual (bidirectional) links of a note: the
 * notes it links to that also link back. Powers the "↔" badge in the panel.
 *
 * Case-insensitive (ids are lowercased before comparing and in the result), so
 * it stays correct regardless of how a given id was cased upstream.
 */
export function intersectIds(a: Iterable<string>, b: Iterable<string>): Set<string> {
  const other = new Set<string>();
  for (const id of b) other.add(id.toLowerCase());
  const both = new Set<string>();
  for (const id of a) {
    const low = id.toLowerCase();
    if (other.has(low)) both.add(low);
  }
  return both;
}
