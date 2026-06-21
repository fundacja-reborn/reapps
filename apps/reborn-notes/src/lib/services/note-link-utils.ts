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
