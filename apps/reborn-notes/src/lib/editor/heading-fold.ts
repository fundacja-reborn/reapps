/**
 * Collapsible sections: fold everything under a heading (issue #582).
 *
 * Markdown has no syntax for a collapsible block, so nothing is written to the
 * note: a fold is editor state, like the caret. Every heading with something
 * under it gets a chevron button at the end of its line; a click hides the text
 * up to the next heading of the same or a higher level and leaves a small "…"
 * mark in its place. Folds are kept while the note stays open and are gone when
 * it is opened again.
 *
 * The folding itself is CodeMirror's (`codeFolding`: the state field, the
 * placeholder, unfolding when the caret or a search match lands inside). This
 * module adds what the stock `foldGutter` cannot give us:
 *
 * - headings only. `foldable()` would also offer every multi-line paragraph,
 *   quote and code block, which is noise in a note;
 * - a button inside the heading line, not a gutter. The editor column is
 *   centred (`max-width` + auto margins), so a gutter would sit at the far edge
 *   of the pane, away from the text. The button follows the line, so it is on
 *   the correct side of a right-to-left heading as well;
 * - a section opens when the text under it changes or a line break is typed
 *   at the end of its heading, so no edit lands in hidden text.
 *
 * The button is inert DOM; the click is handled here through
 * `EditorView.domEventHandlers`, the pattern of the heading link button.
 */
import {
  codeFolding,
  ensureSyntaxTree,
  foldEffect,
  foldState,
  foldedRanges,
  syntaxTree,
  unfoldEffect
} from '@codemirror/language';
import {
  EditorSelection,
  EditorState,
  type Extension,
  type Range,
  type StateEffect
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { detectTextDirection } from '@reborn/i18n/direction';
import { FOLD_CHEVRON_ICON } from '../utils/preview-heading-fold';
import { isDraftSetextHeading } from './setext-draft';

export interface FoldRange {
  from: number;
  to: number;
}

export interface HeadingFoldLabels {
  /** aria-label / tooltip of the button on an open section. */
  fold: string;
  /** aria-label / tooltip of the button and the "…" mark on a folded section. */
  unfold: string;
}

export interface HeadingFoldOptions {
  /** Read on every render, so a language switch shows up without a rebuild. */
  labels: () => HeadingFoldLabels;
  /** Called when the note goes from "no folded section" to "some" or back. */
  onFoldedChange?: (anyFolded: boolean) => void;
  /**
   * Called with the 1-based lines of the folded headings whenever that list
   * may have changed (a fold, an unfold, an edit while something is folded).
   * The owner shares it with the rendered preview.
   */
  onFoldedLinesChange?: (lines: number[]) => void;
}

/** Level 1-6 of a heading node (`# ...` or underlined), else null. */
function headingLevel(name: string): number | null {
  const match = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
  return match ? Number(match[1]) : null;
}

/** The heading node that starts on the line `[lineFrom, lineTo]`, if any. */
function headingNodeOnLine(tree: Tree, lineFrom: number, lineTo: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = tree.resolveInner(lineTo, -1); node; node = node.parent) {
    if (node.from < lineFrom) break;
    if (headingLevel(node.name) != null) return node;
  }
  return null;
}

/**
 * End of the section a heading opens: the end of the last block before the
 * next heading of the same or a higher level (same rule as lang-markdown's
 * fold service, kept here so only headings are ever folded).
 */
function sectionEnd(heading: SyntaxNode, level: number): number {
  let last = heading;
  for (;;) {
    const next = last.nextSibling;
    if (!next) break;
    const nextLevel = headingLevel(next.name);
    if (nextLevel != null && nextLevel <= level) break;
    last = next;
  }
  return last.to;
}

/**
 * What folding the heading on this line would hide: from the end of the line
 * to the end of its section. Null when the line is not a heading or has
 * nothing under it.
 */
export function headingFoldRange(
  state: EditorState,
  lineFrom: number,
  lineTo: number,
  tree: Tree = syntaxTree(state)
): FoldRange | null {
  const heading = headingNodeOnLine(tree, lineFrom, lineTo);
  if (!heading) return null;
  const to = sectionEnd(heading, headingLevel(heading.name) ?? 6);
  return to > lineTo ? { from: lineTo, to } : null;
}

/** The fold that starts on this line, if the line is folded. */
export function foldOnLine(state: EditorState, lineFrom: number, lineTo: number): FoldRange | null {
  let found: FoldRange | null = null;
  foldedRanges(state).between(lineFrom, lineTo, (from, to) => {
    if (from >= lineFrom && from <= lineTo && (!found || to > found.to)) found = { from, to };
  });
  return found;
}

/** True while at least one section of the note is folded. */
export function hasFoldedSections(state: EditorState): boolean {
  return foldedRanges(state).size > 0;
}

/** 1-based numbers of the lines whose section is folded, in document order. */
export function foldedHeadingLines(state: EditorState): number[] {
  const lines: number[] = [];
  foldedRanges(state).between(0, state.doc.length, (from) => {
    const line = state.doc.lineAt(from);
    if (from === line.to && lines[lines.length - 1] !== line.number) lines.push(line.number);
  });
  return lines;
}

/** The whole tree where it can be had quickly, else what is parsed so far. */
function fullTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
}

/**
 * Fold effects plus, when the caret would end up inside hidden text, a
 * selection at the end of the heading that hides it. Without the move the next
 * keystroke would type into text the user cannot see.
 */
function foldTransaction(state: EditorState, ranges: readonly FoldRange[]) {
  const effects: StateEffect<unknown>[] = ranges.map((range) => foldEffect.of(range));
  const { head } = state.selection.main;
  let outer: FoldRange | null = null;
  for (const range of ranges) {
    if (head > range.from && head <= range.to && (!outer || range.from < outer.from)) outer = range;
  }
  return outer ? { effects, selection: EditorSelection.cursor(outer.from) } : { effects };
}

/** Fold or unfold the section of the heading on the line at `pos`. */
export function toggleHeadingFoldAt(view: EditorView, pos: number): boolean {
  const { state } = view;
  const line = state.doc.lineAt(pos);
  const folded = foldOnLine(state, line.from, line.to);
  if (folded) {
    view.dispatch({ effects: unfoldEffect.of(folded) });
    return true;
  }
  const range = headingFoldRange(state, line.from, line.to, fullTree(state));
  if (!range) return false;
  view.dispatch(foldTransaction(state, [range]));
  return true;
}

/** Fold the section the caret is in (its nearest heading above). */
export function foldHeadingAtCursor(view: EditorView): boolean {
  const { state } = view;
  const tree = fullTree(state);
  const { head } = state.selection.main;
  const caretLine = state.doc.lineAt(head);
  if (headingNodeOnLine(tree, caretLine.from, caretLine.to)) {
    return foldOnLine(state, caretLine.from, caretLine.to)
      ? false
      : toggleHeadingFoldAt(view, caretLine.from);
  }
  // The top-level block the caret is in, or the one before it when the caret
  // is on a blank line between blocks; then back to the nearest heading.
  let block: SyntaxNode | null = tree.resolveInner(head, -1);
  while (block.parent && block.parent.parent) block = block.parent;
  if (!block.parent) block = block.childBefore(head);
  for (; block; block = block.prevSibling) {
    if (headingLevel(block.name) == null) continue;
    const line = state.doc.lineAt(block.from);
    const range = headingFoldRange(state, line.from, line.to, tree);
    if (!range) return false;
    view.dispatch(foldTransaction(state, [range]));
    return true;
  }
  return false;
}

/** Unfold the section whose heading the caret is on. */
export function unfoldHeadingAtCursor(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const folded = foldOnLine(state, line.from, line.to);
  if (!folded) return false;
  view.dispatch({ effects: unfoldEffect.of(folded) });
  return true;
}

/**
 * Fold every section, the nested ones too: the note reads as an outline, and
 * opening a section shows its sub-headings still folded.
 *
 * One exception: a single heading of the highest level that has the other
 * headings under it (an imported note that starts with `# Title`) stays open.
 * Folding it would leave one line on the screen, which is no outline.
 */
export function foldAllHeadings(view: EditorView): boolean {
  const { state } = view;
  const tree = fullTree(state);
  const sections: { level: number; lineFrom: number; range: FoldRange }[] = [];
  let headings = 0;
  tree.iterate({
    enter(node) {
      const level = headingLevel(node.name);
      if (level == null) return;
      headings++;
      const line = state.doc.lineAt(node.from);
      const range = headingFoldRange(state, line.from, line.to, tree);
      if (range) sections.push({ level, lineFrom: line.from, range });
      return false;
    }
  });
  const top = Math.min(...sections.map((section) => section.level));
  const atTop = sections.filter((section) => section.level === top);
  const wrapper = atTop.length === 1 && headings > 1 ? atTop[0] : null;
  const ranges = sections
    .filter((section) => section !== wrapper)
    .filter((section) => !foldOnLine(state, section.lineFrom, section.range.from))
    .map((section) => section.range);
  if (ranges.length === 0) return false;
  view.dispatch(foldTransaction(state, ranges));
  return true;
}

/** Open every folded section. */
export function unfoldAllHeadings(view: EditorView): boolean {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  if (effects.length === 0) return false;
  view.dispatch({ effects });
  return true;
}

/**
 * Bring the headings on the given lines to the wanted state: `true` folds the
 * section of the heading on that 1-based line, `false` opens it. Lines that
 * are not listed are left alone, and so is a line that is already as wanted,
 * which makes this safe to call with a state that came from the editor itself.
 *
 * Used to follow folds made outside the editor: in the rendered preview, or in
 * the editor of the previous view mode.
 */
export function syncHeadingFolds(view: EditorView, wanted: ReadonlyMap<number, boolean>): boolean {
  const { state } = view;
  let tree: Tree | null = null;
  const toFold: FoldRange[] = [];
  const effects: StateEffect<unknown>[] = [];
  for (const [number, fold] of wanted) {
    if (number < 1 || number > state.doc.lines) continue;
    const line = state.doc.line(number);
    const folded = foldOnLine(state, line.from, line.to);
    if (fold && !folded) {
      tree ??= fullTree(state);
      const range = headingFoldRange(state, line.from, line.to, tree);
      if (range) toFold.push(range);
    } else if (!fold && folded) {
      effects.push(unfoldEffect.of(folded));
    }
  }
  if (toFold.length === 0 && effects.length === 0) return false;
  const fold = foldTransaction(state, toFold);
  view.dispatch({ ...fold, effects: [...fold.effects, ...effects] });
  return true;
}

// ── Button ─────────────────────────────────────────────────────────

// The chevron (`FOLD_CHEVRON_ICON`, shared with the rendered preview) points
// down. A folded section turns it sideways in CSS, towards the end of the
// line: right in a left-to-right heading, left in a right-to-left one. Lines
// carry `dir="auto"`, which CSS cannot read, so the direction of the heading
// text is worked out here (first strong character, the same rule).

class FoldToggleWidget extends WidgetType {
  constructor(
    readonly folded: boolean,
    readonly label: string,
    readonly rtl: boolean
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof FoldToggleWidget &&
      other.folded === this.folded &&
      other.label === this.label &&
      other.rtl === this.rtl
    );
  }

  toDOM(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'cm-hfold-toggle' + (this.folded ? ' cm-hfold-folded' : '') + (this.rtl ? ' cm-hfold-rtl' : '');
    btn.title = this.label;
    btn.setAttribute('aria-label', this.label);
    btn.setAttribute('aria-expanded', this.folded ? 'false' : 'true');
    btn.innerHTML = FOLD_CHEVRON_ICON;
    // Keep the press from moving the caret into the heading (in Live Preview
    // that would swap the rendered line for raw Markdown before the click) and
    // from opening the on-screen keyboard.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    return btn;
  }

  ignoreEvent(): boolean {
    // Let the click reach the handler below.
    return false;
  }
}

function buildToggles(view: EditorView, labels: HeadingFoldLabels): DecorationSet {
  const { state } = view;
  const tree = syntaxTree(state);
  const caretLine = state.doc.lineAt(state.selection.main.head).from;
  const decorations: Range<Decoration>[] = [];
  const seen = new Set<number>();

  const addLine = (lineFrom: number, lineTo: number, folded: boolean) => {
    if (seen.has(lineFrom)) return;
    seen.add(lineFrom);
    const active = lineFrom === caretLine ? ' cm-hfold-active' : '';
    decorations.push(Decoration.line({ class: `cm-hfold-line${active}` }).range(lineFrom));
    const rtl = detectTextDirection(state.doc.sliceString(lineFrom, lineTo)) === 'rtl';
    decorations.push(
      Decoration.widget({
        widget: new FoldToggleWidget(folded, folded ? labels.unfold : labels.fold, rtl),
        side: 1
      }).range(lineTo)
    );
  };

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (headingLevel(node.name) == null) return;
        const line = state.doc.lineAt(node.from);
        const folded = foldOnLine(state, line.from, line.to) != null;
        // A lone `-` / `=` still being typed under a paragraph is not a heading
        // yet (`setext-draft.ts`): no button popping up on the paragraph.
        if (!folded && isDraftSetextHeading(state, node.node)) return false;
        if (folded || headingFoldRange(state, line.from, line.to, tree)) {
          addLine(line.from, line.to, folded);
        }
        return false;
      }
    });
    // A fold whose line is no longer a heading (the `#` was deleted) keeps its
    // button, so the hidden text can always be brought back.
    foldedRanges(state).between(from, to, (foldFrom) => {
      const line = state.doc.lineAt(foldFrom);
      if (foldFrom === line.to) addLine(line.from, line.to, true);
    });
  }
  return Decoration.set(decorations, true);
}

function togglePlugin(options: HeadingFoldOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      label: string;

      constructor(view: EditorView) {
        const labels = options.labels();
        this.label = labels.fold + '\n' + labels.unfold;
        this.decorations = buildToggles(view, labels);
      }

      update(update: ViewUpdate) {
        const labels = options.labels();
        const label = labels.fold + '\n' + labels.unfold;
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          label !== this.label ||
          update.startState.field(foldState, false) !== update.state.field(foldState, false) ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.label = label;
          this.decorations = buildToggles(update.view, labels);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}

// ── Edits next to hidden text ──────────────────────────────────────

/**
 * Opens a folded section when an edit reaches it:
 * - a change inside the hidden text (find and replace, an edit from another
 *   device);
 * - typing right after the "…" mark. The caret there is at the end of the
 *   hidden text, so the new text would belong to the last hidden line while
 *   showing up next to the heading;
 * - a line break at the end of the heading, which would leave the "…" mark
 *   alone on a line of its own.
 * Editing the heading text itself keeps the fold.
 */
const unfoldOnEdit = EditorState.transactionExtender.of((tr) => {
  if (!tr.docChanged) return null;
  const folds = tr.startState.field(foldState, false);
  if (!folds || folds.size === 0) return null;
  const effects: StateEffect<unknown>[] = [];
  folds.between(0, tr.startState.doc.length, (from, to) => {
    let touched = false;
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      const atHeadingEnd = fromA === from && toA === from;
      if (atHeadingEnd) {
        if (tr.newDoc.sliceString(fromB, toB).includes('\n')) touched = true;
      } else if (fromA <= to && toA > from) {
        // Inside the hidden text, or at its end (typing after the mark).
        touched = true;
      }
    });
    if (!touched) return;
    const mappedFrom = tr.changes.mapPos(from, 1);
    const mappedTo = tr.changes.mapPos(to, -1);
    if (mappedTo > mappedFrom) effects.push(unfoldEffect.of({ from: mappedFrom, to: mappedTo }));
  });
  return effects.length ? { effects } : null;
});

// ── Extension ──────────────────────────────────────────────────────

/** Same keys as CodeMirror's `foldKeymap`, bound to the heading-only commands. */
const headingFoldKeymap = keymap.of([
  { key: 'Ctrl-Shift-[', mac: 'Cmd-Alt-[', run: foldHeadingAtCursor },
  { key: 'Ctrl-Shift-]', mac: 'Cmd-Alt-]', run: unfoldHeadingAtCursor },
  { key: 'Ctrl-Alt-[', run: foldAllHeadings },
  { key: 'Ctrl-Alt-]', run: unfoldAllHeadings }
]);

export function headingFold(options: HeadingFoldOptions): Extension {
  return [
    codeFolding({
      placeholderDOM(_view, onclick) {
        const mark = document.createElement('span');
        const label = options.labels().unfold;
        mark.className = 'cm-hfold-placeholder';
        mark.textContent = '…';
        mark.title = label;
        mark.setAttribute('aria-label', label);
        mark.onclick = onclick;
        return mark;
      }
    }),
    unfoldOnEdit,
    togglePlugin(options),
    headingFoldKeymap,
    EditorView.domEventHandlers({
      click(event, view) {
        const button = (event.target as HTMLElement | null)?.closest('.cm-hfold-toggle');
        if (!button) return false;
        event.preventDefault();
        return toggleHeadingFoldAt(view, view.posAtDOM(button));
      }
    }),
    EditorView.updateListener.of((update) => {
      const before = hasFoldedSections(update.startState);
      const after = hasFoldedSections(update.state);
      if (before !== after) options.onFoldedChange?.(after);
      if (!options.onFoldedLinesChange) return;
      // A fold or an unfold, or an edit that may have moved a folded heading
      // to another line (or renamed it, which the owner cares about).
      const foldsChanged =
        update.startState.field(foldState, false) !== update.state.field(foldState, false);
      if (foldsChanged || (update.docChanged && (before || after))) {
        options.onFoldedLinesChange(foldedHeadingLines(update.state));
      }
    })
  ];
}
