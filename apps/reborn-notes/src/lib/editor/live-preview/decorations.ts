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
import { type EditorState, type Range, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Text } from '@codemirror/state';
import type { ImageLoadMode } from '@reborn/storage';
import { CodeBlockWidget, LinkWidget } from './widgets';
import { ImageWidget, type ImageWidgetLabels, getLoadedImages } from './image-widget';
import { TableWidget } from './table-widget';
import { parseTable } from './table-parse';

/**
 * Options threaded into `buildDecorations` from `createLivePreviewExtension`.
 * Currently only carries image-related preferences; structured as an object
 * so future runtime-configurable knobs can join without churning the API.
 */
export interface BuildDecorationsOptions {
  imageLoadMode: ImageLoadMode;
  imageLabels: ImageWidgetLabels;
}

const DEFAULT_OPTIONS: BuildDecorationsOptions = {
  imageLoadMode: 'ask',
  imageLabels: { load: 'Load image', base64Blocked: 'Embedded images are not supported' }
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
const CODE_LINE = Decoration.line({ class: 'cm-lp-code-line' });
const CODE_LINE_FIRST = Decoration.line({ class: 'cm-lp-code-line cm-lp-code-line-first' });
const CODE_LINE_LAST = Decoration.line({ class: 'cm-lp-code-line cm-lp-code-line-last' });

const HEADING_LINE: Record<number, Decoration> = {
  1: Decoration.line({ class: 'cm-lp-h1-line' }),
  2: Decoration.line({ class: 'cm-lp-h2-line' }),
  3: Decoration.line({ class: 'cm-lp-h3-line' }),
  4: Decoration.line({ class: 'cm-lp-h4-line' }),
  5: Decoration.line({ class: 'cm-lp-h5-line' }),
  6: Decoration.line({ class: 'cm-lp-h6-line' })
};
const STRONG_MARK = Decoration.mark({ class: 'cm-lp-strong' });
const EM_MARK = Decoration.mark({ class: 'cm-lp-em' });
const STRIKE_MARK = Decoration.mark({ class: 'cm-lp-strike' });
const INLINE_CODE_MARK = Decoration.mark({ class: 'cm-lp-code' });
const BLOCKQUOTE_LINE = Decoration.line({ class: 'cm-lp-blockquote-line' });

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

  tree.iterate({
    enter(nodeRef) {
      const name = nodeRef.type.name;
      const from = nodeRef.from;
      const to = nodeRef.to;

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
              widget: new TableWidget(parsed),
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
              widget: new CodeBlockWidget(code, info),
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

      // ─── ATX Headings (# Heading) ────────────────────────────────
      const headingMatch = /^ATXHeading([1-6])$/.exec(name);
      if (headingMatch) {
        const level = parseInt(headingMatch[1], 10);
        const lineDeco = HEADING_LINE[level];
        if (!lineDeco) return false;

        const line = doc.lineAt(from);
        ranges.push(lineDeco.range(line.from));

        if (!isAnySelectionInRange(state, from, to)) {
          const headerMark = findFirstChild(nodeRef.node, 'HeaderMark');
          if (headerMark) {
            // Hide "#... " — including the trailing space if present
            const next = doc.sliceString(headerMark.to, headerMark.to + 1);
            const hideTo = next === ' ' ? headerMark.to + 1 : headerMark.to;
            ranges.push(HIDDEN.range(headerMark.from, hideTo));
          }
        }
        return; // descend so inline children inside heading text get decorated
      }

      // ─── Strong (**bold** / __bold__) ────────────────────────────
      if (name === 'StrongEmphasis') {
        ranges.push(STRONG_MARK.range(from, to));
        if (!isAnySelectionInRange(state, from, to)) {
          forEachChild(nodeRef.node, 'EmphasisMark', (mark) => {
            ranges.push(HIDDEN.range(mark.from, mark.to));
          });
        }
        return; // descend for nested emphasis/code
      }

      // ─── Emphasis (*italic* / _italic_) ──────────────────────────
      if (name === 'Emphasis') {
        ranges.push(EM_MARK.range(from, to));
        if (!isAnySelectionInRange(state, from, to)) {
          forEachChild(nodeRef.node, 'EmphasisMark', (mark) => {
            ranges.push(HIDDEN.range(mark.from, mark.to));
          });
        }
        return;
      }

      // ─── Strikethrough (~~text~~) — GFM ──────────────────────────
      if (name === 'Strikethrough') {
        ranges.push(STRIKE_MARK.range(from, to));
        if (!isAnySelectionInRange(state, from, to)) {
          forEachChild(nodeRef.node, 'StrikethroughMark', (mark) => {
            ranges.push(HIDDEN.range(mark.from, mark.to));
          });
        }
        return;
      }

      // ─── Inline code (`code`) ────────────────────────────────────
      if (name === 'InlineCode') {
        ranges.push(INLINE_CODE_MARK.range(from, to));
        if (!isAnySelectionInRange(state, from, to)) {
          forEachChild(nodeRef.node, 'CodeMark', (mark) => {
            ranges.push(HIDDEN.range(mark.from, mark.to));
          });
        }
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
          if (!isAnySelectionInRange(state, line.from, line.to)) {
            const m = /^(\s*>\s?)/.exec(line.text);
            if (m) {
              ranges.push(HIDDEN.range(line.from, line.from + m[1].length));
            }
          }
        }
        return; // descend into paragraph/inline content
      }

      // ─── List items (bullet or ordered) ──────────────────────────
      if (name === 'ListItem') {
        const itemLine = doc.lineAt(from);
        const listMark = findFirstChild(nodeRef.node, 'ListMark');
        const markText = listMark ? doc.sliceString(listMark.from, listMark.to) : '';
        const isOrdered = /^\d/.test(markText);
        const depth = getListDepth(nodeRef.node);
        const lineDecoSet = isOrdered ? ORDERED_LINE : BULLET_LINE;
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

          // Bullets: hide "- " / "* " when cursor outside this line.
          // Ordered: keep marker visible — the number is meaningful content.
          const cursorOnLine = isAnySelectionInRange(state, itemLine.from, itemLine.to);
          if (!isOrdered && !cursorOnLine) {
            const next = doc.sliceString(listMark.to, listMark.to + 1);
            const hideTo = next === ' ' ? listMark.to + 1 : listMark.to;
            ranges.push(HIDDEN.range(listMark.from, hideTo));
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
 * Forwards a click in the "padding zone" of a list-item line (the area left
 * of the marker and over the rendered `::before` bullet) to the content start
 * (position right after `- ` / `1. `). Without this, CM6's `posAtCoords` maps
 * such clicks to `itemLine.from`, which then bumps to `listMark.from` via
 * the atomic prefix — leaving the cursor BEFORE the marker, where the user
 * has to manually arrow-right twice to start typing.
 *
 * Trigger condition: `event.target` is the `.cm-line` element itself (i.e.
 * the click did NOT land on any text node / span inside the line). When the
 * user clicks an actual character — including the marker once it's revealed
 * (cursor on line) — `target` is a child span and we let CM6's default
 * selection handling run, so the caret lands exactly where clicked.
 */
export const livePreviewListClickForward = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement | null;
    if (!target || !target.classList) return false;
    if (!target.classList.contains('cm-line')) return false;
    if (
      !target.classList.contains('cm-lp-bullet-line') &&
      !target.classList.contains('cm-lp-ordered-line')
    ) {
      return false;
    }

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (pos === null) return false;

    const tree = syntaxTree(view.state);
    let n: SyntaxNode | null = tree.resolveInner(pos, -1);
    while (n && n.type.name !== 'ListItem') n = n.parent;
    if (!n) return false;

    const listMark = findFirstChild(n, 'ListMark');
    if (!listMark) return false;

    const next = view.state.doc.sliceString(listMark.to, listMark.to + 1);
    const contentStart = next === ' ' ? listMark.to + 1 : listMark.to;

    event.preventDefault();
    view.dispatch({ selection: { anchor: contentStart } });
    view.focus();
    return true;
  }
});
