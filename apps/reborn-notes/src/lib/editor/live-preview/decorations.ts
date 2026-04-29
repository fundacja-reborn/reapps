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
import { type EditorState, type Range, StateEffect, StateField } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Text } from '@codemirror/state';
import { CodeBlockWidget, LinkWidget } from './widgets';

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
const BULLET_LINE = Decoration.line({ class: 'cm-lp-bullet-line' });
const ORDERED_LINE = Decoration.line({ class: 'cm-lp-ordered-line' });

export function isAnySelectionInRange(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
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

export function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  const doc = state.doc;

  tree.iterate({
    enter(nodeRef) {
      const name = nodeRef.type.name;
      const from = nodeRef.from;
      const to = nodeRef.to;

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
        ranges.push((isOrdered ? ORDERED_LINE : BULLET_LINE).range(itemLine.from));

        // Bullets: hide "- " / "* " when cursor outside this line.
        // Ordered: keep marker visible — the number is meaningful and recognizable.
        if (!isOrdered && listMark && !isAnySelectionInRange(state, itemLine.from, itemLine.to)) {
          const next = doc.sliceString(listMark.to, listMark.to + 1);
          const hideTo = next === ' ' ? listMark.to + 1 : listMark.to;
          ranges.push(HIDDEN.range(listMark.from, hideTo));
        }
        return; // descend so inline content inside item gets decorated
      }
    }
  });

  return Decoration.set(ranges, true);
}

/**
 * State field owning the live-preview decoration set. Must be a `StateField`
 * (not a `ViewPlugin`) because the FencedCode widget uses
 * `Decoration.replace({ block: true })` and CM6 requires block decorations
 * to come from a state-derived source — they affect the height map.
 *
 * Rebuild on `tr.docChanged`, `tr.selection`, or a `rebuildLivePreview` effect.
 * Tree-progress detection lives in a sibling `updateListener`
 * (`livePreviewSyncListener`) which dispatches the effect when the parser
 * finishes a step between transactions.
 */
export const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(value, tr) {
    const forced = tr.effects.some((e) => e.is(rebuildLivePreview));
    if (tr.docChanged || tr.selection || forced) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f)
});

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
