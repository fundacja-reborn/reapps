/**
 * Pure helpers for the note-to-note link graph. Kept free of runes / crypto /
 * storage so the link-extraction logic (the bug-prone, Zero-Knowledge-sensitive
 * part - it must never over-match) is trivially unit-testable.
 */

/**
 * Capture the target UUID of every `[label](note:UUID)` markdown link, with an
 * optional `#heading-slug` anchor (`note:UUID#slug`) - the anchor is ignored for
 * backlink purposes (a link to a heading still backlinks the whole note).
 */
const NOTE_LINK_TARGET_RE =
  /\]\(note:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:#[^)]*)?\)/gi;

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
 * Same `[label](note:UUID#anchor)` shape as {@link NOTE_LINK_TARGET_RE}, but
 * split into three capture groups - the `](note:` prefix, the bare UUID, and the
 * trailing `#anchor)` (or bare `)`) - so {@link remapNoteLinks} can swap just the
 * id and rebuild the link verbatim.
 */
const NOTE_LINK_REWRITE_RE =
  /(\]\(note:)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})((?:#[^)]*)?\))/gi;

/**
 * Rewrite the target of every `[label](note:OLD_UUID)` link to the new id from
 * `idMap`, leaving the label and any `#heading` anchor untouched. A link whose
 * target is absent from the map is returned verbatim - during a portable
 * cross-account import that means a link to a note outside the backup stays as-is
 * (it was already going to dangle) rather than having its surrounding markdown
 * mangled.
 *
 * This is what keeps note-to-note links working after a portable backup import
 * regenerates every note id (see `reencryptPortablePayload`): the importer
 * pre-mints the new ids, then runs this over each note's body so every `note:`
 * target follows its note to the new account. Lookups are case-insensitive on
 * the id (UUIDs from `randomUUID` are lowercase, but a hand-edited link may not
 * be), mirroring {@link extractNoteLinkTargets}.
 */
export function remapNoteLinks(content: string, idMap: ReadonlyMap<string, string>): string {
  if (!content || idMap.size === 0) return content;
  return content.replace(NOTE_LINK_REWRITE_RE, (whole, pre: string, id: string, rest: string) => {
    const mapped = idMap.get(id) ?? idMap.get(id.toLowerCase());
    return mapped ? `${pre}${mapped}${rest}` : whole;
  });
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

/**
 * Collapse links pointing at a heading in the note's OWN body to the bare
 * in-note `[label](#slug)` anchor form. The "copy link to heading" button
 * always copies the full cross-note `[label](note:UUID#slug)`; pasted back into
 * the note it came from, the `note:UUID` prefix is redundant - the bare `#slug`
 * is exactly what the in-note table of contents emits and what survives an
 * export to standalone Markdown. Anchor-less self links (`note:UUID`) and links
 * to OTHER notes are left untouched. Case-insensitive on the id.
 *
 * Used by the editor's paste handler so a heading link dropped back into its
 * source note self-cleans, while the same clipboard text stays a full link
 * everywhere else.
 */
export function simplifySelfNoteLinks(content: string, selfId: string): string {
  if (!content || !selfId) return content;
  // Escape the id for use in a RegExp (UUIDs only contain hex + hyphens, but be
  // defensive). Match only the markdown link-destination form the copy button
  // produces; a bare `note:...` in prose is never rewritten. `#[^)\s]+` requires
  // an actual anchor, so anchor-less self links fall through unchanged.
  const escaped = selfId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\]\\(note:${escaped}(#[^)\\s]+)\\)`, 'gi');
  return content.replace(re, ']($1)');
}

/**
 * Escape the characters that would break a markdown link *label* (`[label](…)`)
 * if they appeared raw: the backslash and the square brackets that delimit the
 * label. Used when a heading's text becomes the label of a copied link.
 */
export function escapeLinkLabel(text: string): string {
  return text.replace(/[\\[\]]/g, '\\$&');
}

/**
 * Build the internal link the "copy link to heading" affordance puts on the
 * clipboard. Shared by Live Preview (`HeadingAnchorWidget` click) and the
 * rendered Preview so the same heading always yields the same link.
 *
 * Always the full cross-note form `[label](note:UUID#slug)` so it pastes into
 * any note; the editor's paste handler ({@link simplifySelfNoteLinks}) collapses
 * it to the bare `[label](#slug)` when it lands back in the note it came from.
 * Falls back to a bare in-note anchor when the note has no id yet (brand-new,
 * unsaved). The label is the heading text, escaped; an empty heading falls back
 * to the slug so the link is never `[](…)`.
 */
export function buildHeadingLink(
  noteId: string | null | undefined,
  slug: string,
  text: string
): string {
  const label = escapeLinkLabel(text) || slug;
  return noteId ? `[${label}](note:${noteId}#${slug})` : `[${label}](#${slug})`;
}
