/**
 * Live Preview decoration builder.
 *
 * Walks the @lezer/markdown syntax tree and emits decorations that hide
 * markdown markers when the cursor is outside their range, while applying
 * typographic mark/line classes so the rendered look matches preview.
 *
 * Cursor INSIDE a node's range → leave raw (do not hide marks).
 * Cursor OUTSIDE → hide markers, render as preview.
 */
import { syntaxTree } from '@codemirror/language';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSetBuilder,
  StateEffect,
  StateField
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Text } from '@codemirror/state';
import type { ImageLoadMode } from '@reborn/storage';
import { CodeBlockWidget, LinkWidget, TaskCheckboxWidget } from './widgets';
import { ImageWidget, type ImageWidgetLabels, getLoadedImages } from './image-widget';
import type { CodeCopyLabels } from './code-copy';
import { TableWidget, type TableWidgetLabels } from './table-widget';
import { parseTable } from './table-parse';
import { TocWidget, type TocWidgetLabels } from './toc-widget';
import { HeadingAnchorWidget } from './heading-anchor-widget';
import { findTocBlockRange, tocInnerMarkdown, isTocStale } from '$lib/utils/toc';
import { extractHeadings } from '$lib/utils/heading-outline';

/**
 * Options threaded into `buildDecorations` from `createLivePreviewExtension`.
 * Currently only carries image-related preferences; structured as an object
 * so future runtime-configurable knobs can join without churning the API.
 */
export interface BuildDecorationsOptions {
  imageLoadMode: ImageLoadMode;
  imageLabels: ImageWidgetLabels;
  codeLabels: CodeCopyLabels;
  tocLabels: TocWidgetLabels;
  /** aria-label / tooltip for the per-heading "copy link" button. */
  headingLinkLabel: string;
  /** i18n labels for the editable table's structural mini-toolbar. */
  tableLabels: TableWidgetLabels;
}

const DEFAULT_OPTIONS: BuildDecorationsOptions = {
  imageLoadMode: 'ask',
  imageLabels: { load: 'Load image', base64Blocked: 'Embedded images are not supported' },
  codeLabels: { copy: 'Copy code', copied: 'Copied' },
  tocLabels: { refresh: 'Refresh', stale: 'Out of date - refresh', remove: 'Remove' },
  headingLinkLabel: 'Copy link to heading',
  tableLabels: {
    alignLeft: 'Align column left',
    alignCenter: 'Align column center',
    alignRight: 'Align column right',
    insertColumnLeft: 'Insert column left',
    insertColumnRight: 'Insert column right',
    deleteColumn: 'Delete column',
    insertRowAbove: 'Insert row above',
    insertRowBelow: 'Insert row below',
    deleteRow: 'Delete row'
  }
};

/**
 * Effect that forces `livePreviewField` to re-run `buildDecorations` outside
 * of doc/selection changes. Two callers:
 *  1. `CodeBlockWidget` — after a lazy language chunk resolves, so the
 *     plaintext fallback can be replaced by the highlighted <pre><code>.
 *  2. `livePreviewSyncListener` (see below) — when `@codemirror/lang-markdown`
 *     finishes an incremental parse step in a transaction with no doc/sel
 *     change, so newly-discovered nodes (e.g. FencedCode) get decorated.
 */
export const rebuildLivePreview = StateEffect.define<null>();

const HIDDEN = Decoration.replace({});
// Visible markdown markers on the actively-edited line (cursor in range). The
// CSS rule in `theme.ts` dims them to `--muted-foreground` so the eye lands
// on content first instead of competing with `#`, `**`, `> `, etc.
const VISIBLE_MARK = Decoration.mark({ class: 'cm-lp-mark' });
const CODE_LINE = Decoration.line({ class: 'cm-lp-code-line' });
const CODE_LINE_FIRST = Decoration.line({ class: 'cm-lp-code-line cm-lp-code-line-first' });
const CODE_LINE_LAST = Decoration.line({ class: 'cm-lp-code-line cm-lp-code-line-last' });

// In-note TOC raw-reveal (cursor inside the block): keep the box background via
// per-line decorations, mirroring the fenced-code-block reveal, so the block
// stays visually distinct instead of blending into the note. First/last lines
// round the corners + pad the ends.
const TOC_LINE = Decoration.line({ class: 'cm-lp-toc-line' });
const TOC_LINE_FIRST = Decoration.line({ class: 'cm-lp-toc-line cm-lp-toc-line-first' });
const TOC_LINE_LAST = Decoration.line({ class: 'cm-lp-toc-line cm-lp-toc-line-last' });

const HEADING_LINE: Record<number, Decoration> = {
  1: Decoration.line({ class: 'cm-lp-h1-line' }),
  2: Decoration.line({ class: 'cm-lp-h2-line' }),
  3: Decoration.line({ class: 'cm-lp-h3-line' }),
  4: Decoration.line({ class: 'cm-lp-h4-line' }),
  5: Decoration.line({ class: 'cm-lp-h5-line' }),
  6: Decoration.line({ class: 'cm-lp-h6-line' })
};
// Variant heading-line decorations carrying `cm-lp-head-active`, used while the
// caret is on the line. Reveals the copy-link button without a hover (the only
// way to surface it on touch). Same line element + heading class as the base
// variant, just one extra class, so the rendered heading is unchanged.
const HEADING_LINE_ACTIVE: Record<number, Decoration> = {
  1: Decoration.line({ class: 'cm-lp-h1-line cm-lp-head-active' }),
  2: Decoration.line({ class: 'cm-lp-h2-line cm-lp-head-active' }),
  3: Decoration.line({ class: 'cm-lp-h3-line cm-lp-head-active' }),
  4: Decoration.line({ class: 'cm-lp-h4-line cm-lp-head-active' }),
  5: Decoration.line({ class: 'cm-lp-h5-line cm-lp-head-active' }),
  6: Decoration.line({ class: 'cm-lp-h6-line cm-lp-head-active' })
};
const STRONG_MARK = Decoration.mark({ class: 'cm-lp-strong' });
const EM_MARK = Decoration.mark({ class: 'cm-lp-em' });
const STRIKE_MARK = Decoration.mark({ class: 'cm-lp-strike' });
const INLINE_CODE_MARK = Decoration.mark({ class: 'cm-lp-code' });
const BLOCKQUOTE_LINE = Decoration.line({ class: 'cm-lp-blockquote-line' });
const HR_LINE = Decoration.line({ class: 'cm-lp-hr-line' });

// Visual cap on list nesting. Tapered ramp in `theme.ts` keeps even d12
// (~14.5em ≈ 232px) usable on a 360px viewport; CommonMark realistically
// never goes deeper. Bumping this requires extending `.cm-lp-bullet-d{N}`
// / `.cm-lp-ordered-d{N}` rules in theme.ts and the matching
// `.preview ul[data-d{N}]` / `ol[data-d{N}]` rules in MarkdownPreview.svelte.
const MAX_LIST_DEPTH = 12;

const BULLET_LINE: Decoration[] = Array.from({ length: MAX_LIST_DEPTH }, (_, i) =>
  Decoration.line({ class: `cm-lp-bullet-line cm-lp-bullet-d${i + 1}` })
);
const ORDERED_LINE: Decoration[] = Array.from({ length: MAX_LIST_DEPTH }, (_, i) =>
  Decoration.line({ class: `cm-lp-ordered-line cm-lp-ordered-d${i + 1}` })
);
const TASK_LINE: Decoration[] = Array.from({ length: MAX_LIST_DEPTH }, (_, i) =>
  Decoration.line({ class: `cm-lp-task-line cm-lp-task-d${i + 1}` })
);
const TASK_LINE_CHECKED: Decoration[] = Array.from({ length: MAX_LIST_DEPTH }, (_, i) =>
  Decoration.line({ class: `cm-lp-task-line cm-lp-task-d${i + 1} cm-lp-task-checked` })
);

export function isAnySelectionInRange(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}

/**
 * Counts BulletList/OrderedList ancestors of a ListItem node — the ListItem's
 * own list parent is depth 1, a list inside another list is depth 2, etc.
 *
 * Walking the parent chain is robust to mid-edit malformed trees (the
 * incremental parser sometimes returns nodes with incomplete children, but
 * parent linkage stays stable) and cheap (≤ MAX_LIST_DEPTH hops).
 *
 * Mixed bullet/ordered nesting counts both — depth follows the visual nesting
 * the user sees in Preview's `<ul>`/`<ol>` tree.
 */
function getListDepth(node: SyntaxNode): number {
  let depth = 0;
  let p = node.parent;
  while (p) {
    const n = p.type.name;
    if (n === 'BulletList' || n === 'OrderedList') depth++;
    p = p.parent;
  }
  return Math.min(Math.max(depth, 1), MAX_LIST_DEPTH);
}

function findFirstChild(node: SyntaxNode, name: string): SyntaxNode | null {
  let child = node.firstChild;
  while (child) {
    if (child.type.name === name) return child;
    child = child.nextSibling;
  }
  return null;
}

function forEachChild(
  node: SyntaxNode,
  name: string,
  fn: (child: SyntaxNode) => void
): void {
  let child = node.firstChild;
  while (child) {
    if (child.type.name === name) fn(child);
    child = child.nextSibling;
  }
}

function extractCodeInfo(node: SyntaxNode, doc: Text): string | null {
  const child = findFirstChild(node, 'CodeInfo');
  if (!child) return null;
  const info = doc.sliceString(child.from, child.to).trim();
  return info || null;
}

function extractCodeText(node: SyntaxNode, doc: Text): string {
  // Concatenate all CodeText children. The Lezer markdown parser splits
  // multi-line content into one CodeText per line plus newline separators —
  // we slice from the first to the last to preserve internal line breaks.
  let first = -1;
  let last = -1;
  let child = node.firstChild;
  while (child) {
    if (child.type.name === 'CodeText') {
      if (first === -1) first = child.from;
      last = child.to;
    }
    child = child.nextSibling;
  }
  if (first === -1 || last === -1) return '';
  return doc.sliceString(first, last);
}

function extractLinkParts(node: SyntaxNode, doc: Text): { text: string; url: string } | null {
  // @lezer/markdown Link layout: LinkMark "[" ... LinkMark "]" LinkMark "(" URL LinkMark ")"
  let openBracket = -1;
  let closeBracket = -1;
  let url: string | null = null;
  let child = node.firstChild;
  while (child) {
    const n = child.type.name;
    if (n === 'LinkMark') {
      const ch = doc.sliceString(child.from, child.to);
      if (ch === '[' && openBracket === -1) openBracket = child.to;
      else if (ch === ']' && closeBracket === -1) closeBracket = child.from;
    } else if (n === 'URL') {
      url = doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }
  if (openBracket === -1 || closeBracket === -1 || closeBracket < openBracket) return null;
  if (url === null) return null;
  const text = doc.sliceString(openBracket, closeBracket);
  return { text, url };
}

/**
 * Pulls alt text + URL + optional title out of a Lezer `Image` node.
 *
 * Image layout from `@lezer/markdown`:
 *   Image
 *     ImageMark "!"
 *     LinkMark  "["
 *     (alt text inline content)
 *     LinkMark  "]"
 *     LinkMark  "("
 *     URL
 *     [LinkTitle]   ← optional, e.g. `"hover title"`
 *     LinkMark  ")"
 *
 * Returns null for malformed nodes (parser still emits Image even if the
 * source is incomplete during typing).
 */
function extractImageParts(
  node: SyntaxNode,
  doc: Text
): { alt: string; url: string; title: string } | null {
  let openBracket = -1;
  let closeBracket = -1;
  let url: string | null = null;
  let title = '';
  let child = node.firstChild;
  while (child) {
    const n = child.type.name;
    if (n === 'LinkMark') {
      // Image's opening LinkMark is "![" (two chars), not just "[" — match
      // by suffix so we tolerate that without a separate ImageMark child.
      const ch = doc.sliceString(child.from, child.to);
      if (ch.endsWith('[') && openBracket === -1) openBracket = child.to;
      else if (ch === ']' && closeBracket === -1) closeBracket = child.from;
    } else if (n === 'URL') {
      url = doc.sliceString(child.from, child.to);
    } else if (n === 'LinkTitle') {
      // Includes surrounding quotes — strip them to match the Markdown semantics.
      const raw = doc.sliceString(child.from, child.to);
      title = raw.replace(/^["'(]/, '').replace(/["')]$/, '');
    }
    child = child.nextSibling;
  }
  if (openBracket === -1 || closeBracket === -1 || closeBracket < openBracket) return null;
  if (url === null) return null;
  const alt = doc.sliceString(openBracket, closeBracket);
  return { alt, url, title };
}

export function buildDecorations(
  state: EditorState,
  options: BuildDecorationsOptions = DEFAULT_OPTIONS
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  const doc = state.doc;
  const loaded = getLoadedImages(state);

  // ─── In-note table of contents ───────────────────────────────
  // The managed `<!-- toc -->` block is NOT a single syntax node (comment +
  // paragraph + list + comment), so it is found by text range, not tree node.
  // Cursor OUTSIDE → replace the whole line span with one boxed `TocWidget`
  // (mirrors the rendered preview) and skip every node within it below, so
  // nothing decorates under the block widget. Cursor INSIDE → emit no widget and
  // let the raw markdown (markers + list) show for editing — the same
  // click-to-edit reveal as fenced code blocks.
  const docText = doc.toString();

  // Heading anchor slugs (deduplicated) keyed by 1-based line number. Built from
  // the SAME `extractHeadings` the rendered preview + TOC use, so a copied
  // `#slug` always resolves to its heading. Lazy: only computed once the first
  // ATXHeading node is hit, so notes without headings pay nothing.
  let headingMetaByLine: Map<number, { slug: string; text: string }> | null = null;
  const headingMetaAt = (lineNumber: number): { slug: string; text: string } | undefined => {
    if (headingMetaByLine === null) {
      headingMetaByLine = new Map();
      for (const h of extractHeadings(docText)) {
        headingMetaByLine.set(h.line, { slug: h.slug, text: h.text });
      }
    }
    return headingMetaByLine.get(lineNumber);
  };

  const tocRange = findTocBlockRange(docText);
  let tocSkipFrom = -1;
  let tocSkipTo = -1;
  if (tocRange) {
    const startLine = doc.lineAt(tocRange.from);
    const endLine = doc.lineAt(tocRange.to);
    // Skip every node within the block in BOTH states — the widget replaces it
    // (cursor outside) or the raw reveal owns its lines (cursor inside) — so
    // nothing double-decorates the TOC.
    tocSkipFrom = startLine.from;
    tocSkipTo = endLine.to;
    if (!isAnySelectionInRange(state, startLine.from, endLine.to)) {
      // Cursor outside → one boxed widget.
      const innerMd = tocInnerMarkdown(docText) ?? '';
      // Drift is independent of the (preserved) title, so a bare fallback is
      // fine here — see `isTocStale`.
      const stale = isTocStale(docText, { title: '' });
      ranges.push(
        Decoration.replace({
          widget: new TocWidget(innerMd, stale, options.tocLabels),
          block: true
        }).range(startLine.from, endLine.to)
      );
    } else {
      // Cursor inside → raw markdown for editing (fully raw, like a fenced code
      // block), but keep the box background per-line so the block stays distinct
      // instead of blending into the note.
      const lineCount = endLine.number - startLine.number;
      for (let n = startLine.number; n <= endLine.number; n++) {
        const ln = doc.line(n);
        let deco: Decoration = TOC_LINE;
        if (n === startLine.number) deco = TOC_LINE_FIRST;
        else if (n === endLine.number && lineCount > 0) deco = TOC_LINE_LAST;
        ranges.push(deco.range(ln.from));
      }
    }
  }

  tree.iterate({
    enter(nodeRef) {
      const name = nodeRef.type.name;
      const from = nodeRef.from;
      const to = nodeRef.to;

      // Skip everything inside the TOC block (nodes fully contained in it) — the
      // widget replaces it, or the raw reveal's line decorations own it, so any
      // node decoration here would clash. Containment (not just `from >=`) lets a
      // root/container spanning past the block still descend to decorate siblings
      // before and after it.
      if (tocSkipFrom >= 0 && from >= tocSkipFrom && to <= tocSkipTo) {
        return false;
      }

      // ─── GFM Table — always rendered as an editable widget ────────
      // Unlike other live-preview elements, tables do NOT switch to raw
      // markdown when the cursor is "inside" their range. The widget owns
      // editing through contenteditable cells, so cursor-in-range checks
      // are intentionally absent here. CM6 atomic ranges (see
      // `livePreviewAtomicRanges` below) prevent the cursor from landing
      // mid-table in the markdown source.
      if (name === 'Table') {
        const parsed = parseTable(state, nodeRef.node);
        if (parsed) {
          ranges.push(
            Decoration.replace({
              widget: new TableWidget(parsed, options.tableLabels),
              block: true
            }).range(parsed.from, parsed.to)
          );
          return false;
        }
        // Malformed table — fall through and let other handlers run.
      }

      // ─── Fenced code block (```lang … ```) ───────────────────────
      if (name === 'FencedCode') {
        const startLine = doc.lineAt(from);
        const endLine = doc.lineAt(to);
        const cursorInside = isAnySelectionInRange(state, from, to);

        if (!cursorInside) {
          // Replace the whole block (fences + body) with a rendered widget.
          // `block: true` is required for replace decorations spanning whole lines.
          const info = extractCodeInfo(nodeRef.node, doc);
          const code = extractCodeText(nodeRef.node, doc);
          ranges.push(
            Decoration.replace({
              widget: new CodeBlockWidget(code, info, options.codeLabels),
              block: true
            }).range(startLine.from, endLine.to)
          );
          return false;
        }

        // Cursor inside: show raw markdown but style the lines as a code block
        // (background, monospace). The nested CM6 parser registered through
        // `markdown({ codeLanguages })` handles syntax colouring of body lines.
        const lineCount = endLine.number - startLine.number;
        for (let n = startLine.number; n <= endLine.number; n++) {
          const ln = doc.line(n);
          let deco: Decoration = CODE_LINE;
          if (n === startLine.number) deco = CODE_LINE_FIRST;
          else if (n === endLine.number && lineCount > 0) deco = CODE_LINE_LAST;
          ranges.push(deco.range(ln.from));
        }
        return false;
      }

      // ─── Horizontal rule / thematic break (---, ***, ___) ────────
      // Cursor off the line → hide the raw marker chars and paint the (now
      // empty) line as a divider via a centered CSS border (`cm-lp-hr-line`),
      // mirroring Preview's <hr>. Cursor on the line → reveal the raw `---`
      // dimmed so it stays editable — same away-renders / caret-edits pattern
      // as headings and blockquotes.
      //
      // A thematic break occupies the whole line and has no other content, so
      // we hide `line.from..line.to` rather than the node range. That also
      // cleanly covers the up-to-3-space indented form (where the node starts
      // after the leading spaces) without leaving stray whitespace visible.
      // Hiding the full line stays WITHIN the line (no trailing newline), so a
      // plain inline replace suffices — no `block: true` needed.
      if (name === 'HorizontalRule') {
        const line = doc.lineAt(from);
        if (!isAnySelectionInRange(state, line.from, line.to)) {
          ranges.push(HR_LINE.range(line.from));
          if (line.to > line.from) ranges.push(HIDDEN.range(line.from, line.to));
        } else if (line.to > line.from) {
          ranges.push(VISIBLE_MARK.range(line.from, line.to));
        }
        return false;
      }

      // ─── ATX Headings (# Heading) ────────────────────────────────
      const headingMatch = /^ATXHeading([1-6])$/.exec(name);
      if (headingMatch) {
        const level = parseInt(headingMatch[1], 10);
        const line = doc.lineAt(from);
        const cursorInside = isAnySelectionInRange(state, from, to);

        // Caret on the heading line switches to the `cm-lp-head-active` variant,
        // which reveals the copy-link button (the only way to surface it on
        // touch, where there is no hover). Same line + heading class otherwise.
        const lineDeco = (cursorInside ? HEADING_LINE_ACTIVE : HEADING_LINE)[level];
        if (!lineDeco) return false;
        ranges.push(lineDeco.range(line.from));

        // Copy-link-to-heading button, pinned to the line's top-right corner.
        // Inert DOM; the click is wired in NoteEditor (the note id, clipboard
        // helper and toast store live in the Svelte layer).
        const headingMeta = headingMetaAt(line.number);
        if (headingMeta) {
          ranges.push(
            Decoration.widget({
              widget: new HeadingAnchorWidget(
                headingMeta.slug,
                headingMeta.text,
                options.headingLinkLabel
              ),
              side: 1
            }).range(line.to)
          );
        }

        const headerMark = findFirstChild(nodeRef.node, 'HeaderMark');
        if (headerMark) {
          if (!cursorInside) {
            // Hide "#... " — including the trailing space if present
            const next = doc.sliceString(headerMark.to, headerMark.to + 1);
            const hideTo = next === ' ' ? headerMark.to + 1 : headerMark.to;
            ranges.push(HIDDEN.range(headerMark.from, hideTo));
          } else if (headerMark.to > headerMark.from) {
            ranges.push(VISIBLE_MARK.range(headerMark.from, headerMark.to));
          }
        }
        return; // descend so inline children inside heading text get decorated
      }

      // ─── Strong (**bold** / __bold__) ────────────────────────────
      if (name === 'StrongEmphasis') {
        ranges.push(STRONG_MARK.range(from, to));
        const cursorInside = isAnySelectionInRange(state, from, to);
        forEachChild(nodeRef.node, 'EmphasisMark', (mark) => {
          if (cursorInside) ranges.push(VISIBLE_MARK.range(mark.from, mark.to));
          else ranges.push(HIDDEN.range(mark.from, mark.to));
        });
        return; // descend for nested emphasis/code
      }

      // ─── Emphasis (*italic* / _italic_) ──────────────────────────
      if (name === 'Emphasis') {
        ranges.push(EM_MARK.range(from, to));
        const cursorInside = isAnySelectionInRange(state, from, to);
        forEachChild(nodeRef.node, 'EmphasisMark', (mark) => {
          if (cursorInside) ranges.push(VISIBLE_MARK.range(mark.from, mark.to));
          else ranges.push(HIDDEN.range(mark.from, mark.to));
        });
        return;
      }

      // ─── Strikethrough (~~text~~) — GFM ──────────────────────────
      if (name === 'Strikethrough') {
        ranges.push(STRIKE_MARK.range(from, to));
        const cursorInside = isAnySelectionInRange(state, from, to);
        forEachChild(nodeRef.node, 'StrikethroughMark', (mark) => {
          if (cursorInside) ranges.push(VISIBLE_MARK.range(mark.from, mark.to));
          else ranges.push(HIDDEN.range(mark.from, mark.to));
        });
        return;
      }

      // ─── Inline code (`code`) ────────────────────────────────────
      if (name === 'InlineCode') {
        ranges.push(INLINE_CODE_MARK.range(from, to));
        const cursorInside = isAnySelectionInRange(state, from, to);
        forEachChild(nodeRef.node, 'CodeMark', (mark) => {
          if (cursorInside) ranges.push(VISIBLE_MARK.range(mark.from, mark.to));
          else ranges.push(HIDDEN.range(mark.from, mark.to));
        });
        return false;
      }

      // ─── Inline images ![alt](url) ───────────────────────────────
      // Cursor outside the image range → render via ImageWidget.
      // Cursor inside → fall through (no widget), CM6 shows raw markdown
      // so the user can edit `![alt](url)` in place — same Live Preview
      // pattern as links/headings.
      //
      // Images nested inside links (`[![alt](img)](url)`) keep raw markdown
      // either way: emitting both a Link widget AND an Image widget would
      // collide, and the nested case is rare enough that "edit as raw" is
      // the simplest correct behaviour.
      if (name === 'Image') {
        const parent = nodeRef.node.parent;
        if (parent && parent.type.name === 'Link') {
          return false;
        }
        if (!isAnySelectionInRange(state, from, to)) {
          const parts = extractImageParts(nodeRef.node, doc);
          if (parts) {
            const effectiveMode = loaded.has(parts.url) ? 'always' : options.imageLoadMode;
            ranges.push(
              Decoration.replace({
                widget: new ImageWidget(
                  parts.url,
                  parts.alt,
                  parts.title,
                  effectiveMode,
                  options.imageLabels
                )
              }).range(from, to)
            );
            return false;
          }
        }
        return false;
      }

      // ─── Links [text](url) ───────────────────────────────────────
      if (name === 'Link') {
        if (!isAnySelectionInRange(state, from, to)) {
          const parts = extractLinkParts(nodeRef.node, doc);
          if (parts) {
            ranges.push(
              Decoration.replace({
                widget: new LinkWidget(parts.text, parts.url)
              }).range(from, to)
            );
            return false;
          }
        }
        return false;
      }

      // ─── Blockquote ──────────────────────────────────────────────
      if (name === 'Blockquote') {
        const startLine = doc.lineAt(from);
        const endLine = doc.lineAt(to);
        for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
          const line = doc.line(lineNo);
          ranges.push(BLOCKQUOTE_LINE.range(line.from));
          const m = /^(\s*>\s?)/.exec(line.text);
          if (m) {
            const markFrom = line.from;
            const markTo = line.from + m[1].length;
            if (!isAnySelectionInRange(state, line.from, line.to)) {
              ranges.push(HIDDEN.range(markFrom, markTo));
            } else if (markTo > markFrom) {
              ranges.push(VISIBLE_MARK.range(markFrom, markTo));
            }
          }
        }
        return; // descend into paragraph/inline content
      }

      // ─── List items (bullet, ordered, or GFM task) ───────────────
      // `@lezer/markdown`'s `TaskList` adds a `Task` block node *inside* the
      // ListItem (alongside ListMark), not as a replacement. So a task item
      // looks like `ListItem(ListMark, Task(TaskMarker, ...inline))`. We
      // detect the Task child here and switch to task-line decorations
      // instead of bullet — this is more reliable than handling `Task` in a
      // separate branch, where the parent ListItem would have already emitted
      // a bullet line class.
      if (name === 'ListItem') {
        const itemLine = doc.lineAt(from);
        const listMark = findFirstChild(nodeRef.node, 'ListMark');
        const taskChild = findFirstChild(nodeRef.node, 'Task');
        const taskMarker = taskChild ? findFirstChild(taskChild, 'TaskMarker') : null;
        const isTask = taskChild !== null && taskMarker !== null;
        const markText = listMark ? doc.sliceString(listMark.from, listMark.to) : '';
        const isOrdered = !isTask && /^\d/.test(markText);
        const depth = getListDepth(nodeRef.node);

        let lineDecoSet: Decoration[];
        if (isTask) {
          const checked = /\[[xX]\]/.test(
            doc.sliceString(taskMarker!.from, taskMarker!.to)
          );
          lineDecoSet = checked ? TASK_LINE_CHECKED : TASK_LINE;
        } else if (isOrdered) {
          lineDecoSet = ORDERED_LINE;
        } else {
          lineDecoSet = BULLET_LINE;
        }
        ranges.push(lineDecoSet[depth - 1].range(itemLine.from));

        if (listMark) {
          // Hide leading indentation whitespace ALWAYS (regardless of cursor
          // position). Showing it on cursor-enter would shift the visible
          // content rightward by the width of the source spaces, making the
          // user think their edit is happening at a deeper indent than it
          // actually is. The depth-class padding on the line already
          // communicates nesting visually — the literal spaces are noise.
          if (listMark.from > itemLine.from) {
            ranges.push(HIDDEN.range(itemLine.from, listMark.from));
          }

          const cursorOnLine = isAnySelectionInRange(state, itemLine.from, itemLine.to);

          if (isTask && taskMarker) {
            const next = doc.sliceString(taskMarker.to, taskMarker.to + 1);
            const replaceTo = next === ' ' ? taskMarker.to + 1 : taskMarker.to;
            if (!cursorOnLine) {
              // Replace `- [ ] ` (ListMark + space + TaskMarker + space) with
              // the interactive checkbox widget. Toggle handler: `livePreviewTaskCheckboxToggle`.
              const checked = /\[[xX]\]/.test(
                doc.sliceString(taskMarker.from, taskMarker.to)
              );
              ranges.push(
                Decoration.replace({
                  widget: new TaskCheckboxWidget(checked)
                }).range(listMark.from, replaceTo)
              );
            } else {
              // Cursor on line — raw `- [ ] ` visible; dim the marker so the
              // checkbox/structural punctuation doesn't compete with content.
              ranges.push(VISIBLE_MARK.range(listMark.from, replaceTo));
            }
          } else if (!isTask && !isOrdered) {
            // Plain bullet — hide "- " / "* " when cursor is off the line so
            // the rendered ::before bullet takes over. Ordered lists keep
            // their numeric marker (the number is meaningful content, not a
            // marker — don't dim it).
            const next = doc.sliceString(listMark.to, listMark.to + 1);
            const hideTo = next === ' ' ? listMark.to + 1 : listMark.to;
            if (!cursorOnLine) {
              ranges.push(HIDDEN.range(listMark.from, hideTo));
            } else {
              ranges.push(VISIBLE_MARK.range(listMark.from, hideTo));
            }
          }
        }
        return; // descend so inline content inside item gets decorated
      }
    }
  });

  return Decoration.set(ranges, true);
}

/**
 * Factory for the StateField owning the live-preview decoration set.
 *
 * A field-per-extension lets us close over per-instance options
 * (`imageLoadMode`, i18n labels) without smuggling them through CM6
 * facets. `createLivePreviewExtension` calls this once and the
 * `Compartment` in NoteEditor reconfigures the whole extension whenever
 * the options change, replacing the field as a side effect.
 *
 * Must be a `StateField` (not a `ViewPlugin`) because the FencedCode and
 * Image widgets use `Decoration.replace({ block: true })` (or are emitted
 * alongside block-replace ranges) and CM6 requires block decorations to
 * come from a state-derived source — they affect the height map.
 *
 * Rebuild on `tr.docChanged`, `tr.selection`, or a `rebuildLivePreview` effect.
 * Tree-progress detection lives in a sibling `updateListener`
 * (`livePreviewSyncListener`) which dispatches the effect when the parser
 * finishes a step between transactions.
 */
export function createLivePreviewField(
  options: BuildDecorationsOptions = DEFAULT_OPTIONS
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, options);
    },
    update(value, tr) {
      const forced = tr.effects.some((e) => e.is(rebuildLivePreview));
      if (tr.docChanged || tr.selection || forced) {
        return buildDecorations(tr.state, options);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f)
  });
}

/**
 * Default field with sensible fallback options. Kept for tests and any
 * legacy callers that don't need per-instance configuration.
 */
export const livePreviewField = createLivePreviewField();

/**
 * Detects incremental parser progress between transactions and dispatches
 * `rebuildLivePreview` so `livePreviewField` rebuilds against the new tree.
 *
 * Why this is needed: `@codemirror/lang-markdown` parses incrementally. The
 * very first paint after mount typically sees a partial tree (no FencedCode
 * yet) — without this listener, no widget gets emitted until the user types
 * or clicks. The late block-replace widget would then shift the height map
 * and the cursor would land on the wrong line (regression v0.10.6).
 *
 * The dispatch is queued via `Promise.resolve().then(...)` because dispatching
 * synchronously inside an updateListener triggers a CM6 reentrancy assertion.
 */
export const livePreviewSyncListener = EditorView.updateListener.of((update) => {
  if (syntaxTree(update.state) === syntaxTree(update.startState)) return;
  // Skip if a rebuild is already requested / will run anyway.
  if (
    update.docChanged ||
    update.selectionSet ||
    update.transactions.some((tr) => tr.effects.some((e) => e.is(rebuildLivePreview)))
  ) {
    return;
  }
  const view = update.view;
  Promise.resolve().then(() => {
    view.dispatch({ effects: rebuildLivePreview.of(null) });
  });
});

/**
 * Atomic ranges for two distinct cases:
 *
 *  1. **Whole `Table` blocks** — selection cannot land mid-table in the
 *     markdown source. Without this, arrow keys / End / PageDown could place
 *     the caret between `|` characters, causing the decorated widget to
 *     flicker and stealing focus from contenteditable cells.
 *
 *  2. **Leading whitespace of nested `ListItem`s** (`[itemLine.from,
 *     listMark.from]`). Pairs with the always-hidden HIDDEN replace
 *     decoration on the same range emitted in `buildDecorations`. Without
 *     this, Home / arrow-Left / posAtCoords could put the cursor in the
 *     middle of zero-width replaced whitespace — invisible cursor, drag
 *     selection of "padding", off-by-N edits.
 *
 *  Tables short-circuit (`return false`) so we don't emit list atomics for
 *  list items that live inside a table cell — tables own their own editing.
 */
export const livePreviewAtomicRanges = EditorView.atomicRanges.of((view) => {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;
  tree.iterate({
    enter(nodeRef) {
      const name = nodeRef.type.name;
      if (name === 'Table') {
        builder.add(nodeRef.from, nodeRef.to, Decoration.mark({}));
        return false;
      }
      if (name === 'ListItem') {
        const itemLine = doc.lineAt(nodeRef.from);
        const listMark = findFirstChild(nodeRef.node, 'ListMark');
        if (listMark && listMark.from > itemLine.from) {
          builder.add(itemLine.from, listMark.from, Decoration.mark({}));
        }
      }
    }
  });
  return builder.finish();
});

/**
 * Resolves a click position inside a list-item line to a forward target, or
 * null if the click should be left to CM6's native selection handling.
 *
 * Returns `{ contentStart }` only when `pos` lies in the "padding/marker zone"
 * (before the first character of actual content) — that's the case the
 * `livePreviewListClickForward` handler exists to fix (#146/#153). When `pos`
 * is already at or past `contentStart`, the user clicked on real content text
 * and CM6's default `posAtCoords` selection is exactly right; forwarding would
 * destroy the intended caret position (#XXX bug: clicks on unstyled list
 * content were being slammed to `contentStart` because plain text nodes have
 * `.cm-line` as their event target).
 *
 * Extracted as a pure function so the gate is unit-testable without mounting
 * a DOM EditorView.
 */
export function resolveListClickForward(
  state: EditorState,
  pos: number
): { contentStart: number } | null {
  const tree = syntaxTree(state);
  // Resolve with both biases and prefer the deepest (tightest-range) ListItem
  // containing `pos`. Neither bias alone is sufficient:
  //  - Leftward (-1) is right for clicks at the END of a line (would otherwise
  //    spill into the next sibling), and is needed inside content.
  //  - Rightward (+1) is right for the very start of a top-level item
  //    (pos === 0; leftward would resolve to `Document` and the walk would
  //    fail) and for the inner ListMark of a nested item (leftward returns the
  //    OUTER ListItem because the inner item's leading whitespace belongs to
  //    the outer item's range in the lezer-markdown tree).
  // Picking the smaller of the two ranges gives the deepest nesting at every
  // boundary case.
  const walk = (n: SyntaxNode | null): SyntaxNode | null => {
    let p = n;
    while (p && p.type.name !== 'ListItem') p = p.parent;
    return p;
  };
  const itemLeft = walk(tree.resolveInner(pos, -1));
  const itemRight = walk(tree.resolveInner(pos, 1));
  let item: SyntaxNode | null;
  if (!itemLeft) item = itemRight;
  else if (!itemRight) item = itemLeft;
  else item = itemRight.to - itemRight.from < itemLeft.to - itemLeft.from ? itemRight : itemLeft;
  if (!item) return null;
  const n = item;

  // For task items, anchor the cursor after the task marker (`[ ] ` / `[x] `)
  // — otherwise the user lands between `- ` and `[`, which collides with the
  // checkbox widget replace range and feels off.
  const taskChild = findFirstChild(n, 'Task');
  const taskMarker = taskChild ? findFirstChild(taskChild, 'TaskMarker') : null;
  let contentStart: number;
  if (taskMarker) {
    const next = state.doc.sliceString(taskMarker.to, taskMarker.to + 1);
    contentStart = next === ' ' ? taskMarker.to + 1 : taskMarker.to;
  } else {
    const listMark = findFirstChild(n, 'ListMark');
    if (!listMark) return null;
    const next = state.doc.sliceString(listMark.to, listMark.to + 1);
    contentStart = next === ' ' ? listMark.to + 1 : listMark.to;
  }

  if (pos >= contentStart) return null;
  return { contentStart };
}

/**
 * Forwards a click in the "padding zone" of a list-item line (the area left
 * of the marker and over the rendered `::before` bullet) to the content start
 * (position right after `- ` / `1. ` / `- [ ] `). Without this, CM6's
 * `posAtCoords` maps such clicks to `itemLine.from`, which then bumps to
 * `listMark.from` via the atomic prefix — leaving the cursor BEFORE the
 * marker, where the user has to manually arrow-right twice to start typing.
 *
 * Two-stage gate:
 *  1. `event.target === .cm-line` — fast reject for clicks that landed on a
 *     wrapping span (highlighted tokens like `**bold**`, `*italic*`, code,
 *     widgets); CM6's default selection already handles those correctly.
 *  2. `pos >= contentStart` — reject clicks resolving to actual content text.
 *     Plain (unstyled) list content has no wrapping span, so its text nodes
 *     bubble events up to `.cm-line` — the target check alone would treat
 *     every such click as a padding-zone click and slam the caret to
 *     `contentStart`, losing the user's intended position. Comparing the
 *     resolved doc position against `contentStart` distinguishes a real
 *     padding-zone click (pos lands in hidden marker / leading whitespace,
 *     i.e. < contentStart) from a content click (pos >= contentStart).
 */
export const livePreviewListClickForward = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement | null;
    if (!target || !target.classList) return false;
    if (!target.classList.contains('cm-line')) return false;
    if (
      !target.classList.contains('cm-lp-bullet-line') &&
      !target.classList.contains('cm-lp-ordered-line') &&
      !target.classList.contains('cm-lp-task-line')
    ) {
      return false;
    }

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (pos === null) return false;

    const result = resolveListClickForward(view.state, pos);
    if (!result) return false;

    event.preventDefault();
    view.dispatch({ selection: { anchor: result.contentStart } });
    view.focus();
    return true;
  }
});

/**
 * DOM event handler that wires the `TaskCheckboxWidget` `<input>` to a doc
 * change. Click on the checkbox toggles the markdown source `[ ] ↔ [x]` in a
 * single CM6 transaction (atomic undo). Native `change` event handles both
 * mouse click and keyboard activation (Space when focused).
 */
export const livePreviewTaskCheckboxToggle = EditorView.domEventHandlers({
  change(event, view) {
    const target = event.target as HTMLElement | null;
    if (!target || !(target instanceof HTMLInputElement)) return false;
    if (!target.classList.contains('cm-lp-task-checkbox')) return false;

    const pos = view.posAtDOM(target);
    if (pos < 0) return false;
    const line = view.state.doc.lineAt(pos);
    const m = /^(\s*[-+*] )(\[[ xX]\])(\s+)/.exec(line.text);
    if (!m) return false;

    const markerFrom = line.from + m[1].length;
    const markerTo = markerFrom + m[2].length;
    const newMarker = target.checked ? '[x]' : '[ ]';
    view.dispatch({
      changes: { from: markerFrom, to: markerTo, insert: newMarker },
      userEvent: 'input.task.toggle'
    });
    return true;
  }
});

/**
 * The owner's TOC mutation callbacks, threaded from `NoteEditor` (which holds
 * the i18n `$t` and the note's content service). The `TocWidget` DOM is inert;
 * this handler is the only place editor TOC clicks act.
 */
export interface TocActions {
  /** Insert-or-refresh the managed block (corner refresh button). */
  refresh: () => void;
  /** Remove the managed block (corner trash button). */
  remove: () => void;
}

/**
 * Wires clicks inside the `TocWidget`:
 *  - refresh / remove corner buttons → the owner's `TocActions` (which mutate the
 *    markdown source the same way the kebab menu and the rendered preview's
 *    toolbar do — all three share one path);
 *  - an entry link (`#slug`) → scroll the editor to that heading line.
 *
 * `mousedown` is prevented on these targets so the click does not move the CM6
 * caret into the block (which would swap the widget for raw markdown before the
 * `click` fires); the work runs on `click` (also fires on keyboard activation of
 * the buttons).
 */
export function livePreviewTocActions(actions?: TocActions): Extension {
  return EditorView.domEventHandlers({
    mousedown(event) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.cm-lp-toc-refresh, .cm-lp-toc-remove, .cm-lp-toc a[href]')) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    click(event, view) {
      const target = event.target as HTMLElement | null;
      if (!target) return false;
      if (target.closest('.cm-lp-toc-refresh')) {
        event.preventDefault();
        actions?.refresh();
        return true;
      }
      if (target.closest('.cm-lp-toc-remove')) {
        event.preventDefault();
        actions?.remove();
        return true;
      }
      const anchor = target.closest('.cm-lp-toc a[href]') as HTMLAnchorElement | null;
      if (anchor) {
        event.preventDefault();
        scrollEditorToSlug(view, anchor.getAttribute('href'));
        return true;
      }
      return false;
    }
  });
}

/**
 * Scrolls the editor to a heading when an in-note anchor link (`[label](#slug)`)
 * in the body is clicked - the bare-anchor twin of the TOC entry handler above.
 * `LinkWidget` renders such links as `a.cm-lp-anchor-link`. `mousedown` is
 * prevented so the click doesn't move the caret into the link (which would swap
 * the rendered link widget for raw markdown before the `click` fires).
 */
export const livePreviewAnchorScroll = EditorView.domEventHandlers({
  mousedown(event) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.cm-lp-anchor-link')) {
      event.preventDefault();
      return true;
    }
    return false;
  },
  click(event, view) {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('.cm-lp-anchor-link') as HTMLAnchorElement | null;
    if (anchor) {
      event.preventDefault();
      scrollEditorToSlug(view, anchor.getAttribute('href'));
      return true;
    }
    return false;
  }
});

/**
 * Scroll the editor to the heading a TOC entry points at. The href is a `#slug`
 * fragment — marked percent-encodes it, so decode before matching the slug
 * `extractHeadings` stamps. Places the caret at the heading line start (outside
 * the TOC block, so the widget stays rendered) and scrolls it near the top.
 */
function scrollEditorToSlug(view: EditorView, href: string | null): void {
  if (!href) return;
  const raw = href.startsWith('#') ? href.slice(1) : href;
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    slug = raw;
  }
  const heading = extractHeadings(view.state.doc.toString()).find((h) => h.slug === slug);
  if (!heading) return;
  const lineNo = Math.min(Math.max(heading.line, 1), view.state.doc.lines);
  const pos = view.state.doc.line(lineNo).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 16 })
  });
  view.focus();
}
