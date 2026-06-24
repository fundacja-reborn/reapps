/**
 * In-note table of contents - a managed Markdown block the user can insert,
 * refresh and remove from the editor.
 *
 * The block links to headings by the SAME slug {@link extractHeadings} stamps on
 * rendered headings (see `heading-outline.ts`), so a note's `[Section](#slug)`
 * links navigate inside the preview, the shared snapshot, the PDF and the Markdown
 * export - everywhere the note's own content is rendered. This util is the single
 * source of the block's shape; it reuses `extractHeadings` directly (no
 * re-implementation), so the TOC slugs can never drift from the heading anchors.
 *
 * The block is delimited by HTML comments so it is:
 *  - self-describing in the source and trivially found/refreshed/removed,
 *  - invisible when rendered read-only (DOMPurify strips the comments), leaving
 *    just the bold title + list,
 *  - byte-identical on a no-op refresh, so autosave/sync treat an unchanged
 *    refresh as a true no-op (no spurious "dirty").
 *
 * The title is rendered as `**bold**` (not a heading) on purpose, so it
 * contributes NO heading of its own - it never pollutes the outline panel or the
 * anchor/slug space.
 *
 *   <!-- toc -->
 *
 *   **Table of contents**
 *
 *   - [Section](#section)
 *     - [Subsection](#subsection)
 *
 *   <!-- /toc -->
 *
 * The blank lines INSIDE the markers keep the title and list as separate
 * Markdown blocks when a read-only viewer (snapshot, history) renders the block
 * directly. The owner's editable preview instead rebuilds the block as one atomic
 * `<nav>` so a corner toolbar can sit on it - see {@link toEditableTocBlock}.
 */

import { extractHeadings, type DocHeading } from './heading-outline';

/** Opening marker of the managed TOC block. */
export const TOC_OPEN = '<!-- toc -->';
/** Closing marker of the managed TOC block. */
export const TOC_CLOSE = '<!-- /toc -->';

/** Matches the whole managed block, markers included (non-greedy). */
const TOC_BLOCK_RE = /<!-- toc -->[\s\S]*?<!-- \/toc -->/;
/** Captures the bold title line of an existing block (preserved across refreshes). */
const TOC_TITLE_RE = /<!-- toc -->\s*\n\s*\n\*\*(.+?)\*\*/;

export interface TocOptions {
  /** Localized rendered title (e.g. `$t('toc.title')`). */
  title: string;
  /** Shallowest heading depth to include (default 1 - notes have a separate title field). */
  min?: number;
  /** Deepest heading depth to include (default 6 - list every heading). */
  max?: number;
}

interface ResolvedOptions {
  title: string;
  min: number;
  max: number;
}

function resolve(opts: TocOptions): ResolvedOptions {
  return { title: opts.title, min: opts.min ?? 1, max: opts.max ?? 6 };
}

/** True when the content already contains a managed TOC block. */
export function hasToc(content: string): boolean {
  return TOC_BLOCK_RE.test(content);
}

/**
 * Character range `[from, to)` of the managed TOC block in `content`, or `null`
 * when there is none. Lets the CM6 Live Preview decoration map the block onto
 * editor lines (so it can render the same box + toolbar the rendered preview
 * shows) without re-implementing the marker regex - this stays the single source.
 */
export function findTocBlockRange(content: string): { from: number; to: number } | null {
  const m = content.match(TOC_BLOCK_RE);
  if (!m || m.index === undefined) return null;
  return { from: m.index, to: m.index + m[0].length };
}

/**
 * Escape the characters that would break a Markdown link label. The backslash
 * (Markdown's escape char) MUST be in the set, otherwise a literal `\` in the
 * heading text would "consume" a following bracket escape and close the label
 * early (e.g. `foo\]bar`). A single character class prefixes each matched char
 * (`\`, `[`, `]`) with a backslash in one left-to-right pass, so the order is
 * correct.
 */
function escapeLabel(text: string): string {
  return text.replace(/[\\[\]]/g, '\\$&');
}

/**
 * Build the managed TOC block (markers + title + list) for the given headings,
 * or `null` when no heading falls in the [min, max] depth window. Indentation is
 * relative to the shallowest included heading, so a note whose headings start at
 * H2 still gets a flush-left list.
 */
export function buildTocBlock(headings: DocHeading[], opts: TocOptions): string | null {
  const { title, min, max } = resolve(opts);
  const included = headings.filter((h) => h.depth >= min && h.depth <= max);
  if (included.length === 0) return null;
  const base = Math.min(...included.map((h) => h.depth));
  const items = included.map((h) => {
    const indent = '  '.repeat(h.depth - base);
    return `${indent}- [${escapeLabel(h.text)}](#${h.slug})`;
  });
  // Blank lines inside the markers are required - see file header.
  return `${TOC_OPEN}\n\n**${title}**\n\n${items.join('\n')}\n\n${TOC_CLOSE}`;
}

/** The bold title of an existing block, or `null` when there is none. */
function existingTitle(content: string): string | null {
  return content.match(TOC_TITLE_RE)?.[1] ?? null;
}

/** Line index (0-based) after which a first-time TOC should be inserted. */
function firstInsertionLine(content: string, headings: DocHeading[]): number {
  const lines = content.split('\n');
  // Past a leading YAML frontmatter block.
  let fmEnd = 0;
  if (lines[0]?.trim() === '---') {
    let i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    fmEnd = Math.min(i + 1, lines.length);
  }
  // Prefer just after the first H1 (the note's lead section); else after frontmatter.
  const h1 = headings.find((h) => h.depth === 1);
  return h1 ? h1.line : fmEnd;
}

/**
 * Insert a TOC (first time) or refresh the existing block in place. Returns the
 * updated content, or `null` when nothing changes (no headings to list, or an
 * existing block is already up to date) so callers can skip a no-op write.
 *
 * Refresh is position-independent: an existing block is rewritten wherever it
 * sits (a power user can move it in Markdown and it stays put), and its title is
 * preserved - only the entry list is regenerated.
 */
export function applyToc(content: string, opts: TocOptions): string | null {
  const resolved = resolve(opts);
  const headings = extractHeadings(content);

  if (TOC_BLOCK_RE.test(content)) {
    // Refresh in place, keeping the user's (possibly translated) title.
    const block = buildTocBlock(headings, { ...resolved, title: existingTitle(content) ?? resolved.title });
    if (!block) {
      // Headings all gone - drop the block (and one trailing blank line).
      const next = content.replace(new RegExp(`${TOC_BLOCK_RE.source}\\n?`), '');
      return next === content ? null : next;
    }
    const next = content.replace(TOC_BLOCK_RE, () => block);
    return next === content ? null : next;
  }

  // First insertion - pinned just after the first H1 (or after frontmatter).
  const block = buildTocBlock(headings, resolved);
  if (!block) return null;

  const lines = content.split('\n');
  const at = firstInsertionLine(content, headings);
  const before = lines.slice(0, at);
  const after = lines.slice(at);
  // Exactly one blank line on each side of the block.
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  while (after.length && after[0].trim() === '') after.shift();
  const head = before.length ? [...before, ''] : [];
  const tail = after.length ? ['', ...after] : [''];
  return [...head, block, ...tail].join('\n');
}

/** Remove the managed block (and one trailing blank line). `null` when none. */
export function removeToc(content: string): string | null {
  const next = content.replace(new RegExp(`${TOC_BLOCK_RE.source}\\n?`), '');
  return next === content ? null : next;
}

/**
 * True when a block exists and refreshing it would change the entry list - i.e.
 * the headings drifted from the TOC. Drives the "out of date" affordance on the
 * refresh action. Title-only differences do NOT count as stale (refresh keeps
 * the existing title), so switching locale never flags an otherwise-current TOC.
 */
export function isTocStale(content: string, opts: TocOptions): boolean {
  return hasToc(content) && applyToc(content, opts) !== null;
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/** The Markdown between the markers (`**Title**` + list), or `null` when there is no block. */
export function tocInnerMarkdown(content: string): string | null {
  const m = content.match(TOC_BLOCK_RE);
  if (!m) return null;
  return m[0].slice(TOC_OPEN.length, -TOC_CLOSE.length).trim();
}

/**
 * Replace the managed block with a single, atomic `<nav>` HTML block for the
 * owner's editable preview, so a corner toolbar can be overlaid on it.
 *
 * Why atomic: `marked` renders an inline HTML block (no blank lines inside) as
 * exactly ONE token, which becomes ONE DOM node - mirroring how a fenced code
 * block is one token / one `.code-block` node carrying the copy button. The
 * preview's source-line mapping (`applySourceLineAttrs`) zips top-level DOM
 * children to top-level tokens by position; wrapping the title + list (multiple
 * tokens) in a `<nav>` would collapse them into one node and drift the line map
 * for every block AFTER the TOC. One token / one node keeps the zip aligned.
 *
 * `innerHtml` is the already-rendered (marked) title + list, so link labels keep
 * full Markdown fidelity; its newlines are collapsed so the `<nav>` stays a
 * single block. `buttonsHtml` is injected right after the opening tag (the
 * toolbar). Trailing newlines pad the replacement to the original block's newline
 * count, so every source line AFTER the TOC keeps its number and split-view
 * scroll-sync stays aligned. A function replacement keeps `$` sequences in the
 * HTML literal (not treated as `String.replace` patterns).
 *
 * Read-only renderers (snapshot, history) never call this - their markers are
 * just stripped by the sanitizer, leaving a plain bold title + list.
 */
export function toEditableTocBlock(content: string, innerHtml: string, buttonsHtml: string): string {
  const m = content.match(TOC_BLOCK_RE);
  if (!m) return content;
  const pad = '\n'.repeat(countNewlines(m[0]));
  const nav = `<nav class="note-toc" data-note-toc>${buttonsHtml}${innerHtml.replace(/\s*\n\s*/g, ' ').trim()}</nav>`;
  return content.replace(TOC_BLOCK_RE, () => nav + pad);
}
