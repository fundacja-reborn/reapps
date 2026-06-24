/**
 * Heading slugs + document outline extraction.
 *
 * One source of truth for "what is the anchor id of a heading", shared by:
 *  - MarkdownPreview (stamps `id` on rendered headings for in-note `#anchor`
 *    links and the outline panel),
 *  - the OutlineSheet panel (lists a note's headings),
 *  - the in-note table of contents (`toc.ts`, builds `[Section](#slug)` entries),
 *  - the import link rewrite (`internal-link-rewrite-utils.ts`, maps an
 *    Obsidian `[[Doc#Heading]]` subpath to `note:UUID#slug`).
 *
 * Every consumer calls these functions directly, so a heading's anchor id, a TOC
 * entry's `#slug` and an outline row can never drift apart.
 *
 * Slugs are GitHub-ish: lowercase, Unicode letters/numbers kept (so Polish /
 * German / French / Spanish headings stay readable), everything else dropped,
 * spaces collapsed to single hyphens, duplicates suffixed `-1`, `-2`, … The goal
 * is *internal* consistency (preview id == link target == outline entry), not
 * byte-identity with GitHub's renderer.
 */

/** A heading discovered in a Markdown document. */
export interface DocHeading {
  /** Heading level, 1-6 (number of leading `#`). */
  depth: number;
  /** Heading text with the leading/trailing `#` and surrounding space removed. */
  text: string;
  /** Anchor id - unique within the document (deduplicated). */
  slug: string;
  /** 1-based source line number (used to scroll the editor in edit mode). */
  line: number;
}

/**
 * Slugify a single heading's text. NOT deduplicated - use
 * {@link assignHeadingSlugs} when you have the whole document, so repeated
 * headings get `-1`/`-2` suffixes consistently.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    // Keep Unicode letters/numbers, underscore, space and hyphen; drop the rest
    // (punctuation, emoji, Markdown markers like `*` `` ` `` `[` `]`). This also
    // makes a heading wrapped in `**bold**` / `` `code` `` slug the same as its
    // rendered text content.
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slugify every heading text in document order, deduplicating collisions the way
 * GitHub does: the first occurrence keeps the bare slug, later ones get `-1`,
 * `-2`, … An empty slug (heading with no slug-able characters) falls back to
 * `section`.
 */
export function assignHeadingSlugs(texts: string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = slugifyHeading(text) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

/** Matches an opening/closing fenced-code marker (``` ``` ``` or `~~~`, 3+). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
/** Matches an ATX heading line: 1-6 `#`, then (optional) space + text. */
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
/** Trailing closing hashes of an ATX heading (`## Foo ##` → `## Foo`). */
const CLOSING_HASHES_RE = /[ \t]+#+[ \t]*$/;

/**
 * Extract the heading outline from a Markdown document.
 *
 * - A leading YAML frontmatter block (`---` … `---`) is skipped.
 * - Fenced code blocks (``` ``` ``` / `~~~`) are skipped, so a `#` comment inside
 *   a code sample is never mistaken for a heading.
 * - Only ATX headings (`#`-prefixed) are recognised. Setext headings
 *   (`===`/`---` underlines) are intentionally NOT supported: `---` is used
 *   heavily as a horizontal rule / frontmatter delimiter in these docs, and
 *   distinguishing the two reliably is error-prone. A Setext heading degrades to
 *   "not in the outline" (and its anchor lands at the top of the note) rather
 *   than risking false positives.
 *
 * Slugs are assigned across the whole returned list, so duplicates are
 * deduplicated deterministically.
 */
export function extractHeadings(markdown: string): DocHeading[] {
  const lines = markdown.split('\n');
  let i = 0;

  // Skip a leading YAML frontmatter block.
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++; // step past the closing delimiter
  }

  const raw: { depth: number; text: string; line: number }[] = [];
  let fence: string | null = null;

  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE_RE.exec(line);

    if (fence !== null) {
      // Inside a fence - close only on a matching-or-longer run of the same char.
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }

    const h = ATX_RE.exec(line);
    if (h) {
      const text = (h[2] ?? '').replace(CLOSING_HASHES_RE, '').trim();
      raw.push({ depth: h[1].length, text, line: i + 1 });
    }
  }

  const slugs = assignHeadingSlugs(raw.map((r) => r.text));
  return raw.map((r, idx) => ({ depth: r.depth, text: r.text, slug: slugs[idx], line: r.line }));
}
