/**
 * Manual text direction for lines of a note.
 *
 * A line takes its direction from its first letter, so an Arabic line that
 * starts with a Latin word (`re/notes ...`) reads left to right (#482). Markdown
 * has no syntax for direction, so the toolbar button keeps the choice in the text
 * as an invisible Unicode mark: RLM or LRM. Browsers count these as the first
 * strong character, so `dir="auto"` in the editor, the preview and the PDF export
 * all follow the mark. It needs no change to the data model, and it survives a
 * Markdown export.
 *
 * The mark goes after the block marker (`# `, `- `, `> `): in front of it, the
 * line would stop being a heading or a list item. Lines that a mark would break
 * (code, tables, thematic breaks) are left alone.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  RangeSetBuilder,
  type ChangeSpec,
  type EditorState,
  type Line,
  type Text,
  type TransactionSpec
} from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { detectTextDirection, type TextDirection } from '@reborn/i18n';
import { directionAbove } from './bidi';

const DIRECTION_MARK: Record<TextDirection, string> = {
  ltr: String.fromCodePoint(0x200e),
  rtl: String.fromCodePoint(0x200f)
};

/** One step of a line's block prefix: indent, quote, bullet, number, heading, task box. */
const BLOCK_MARKER = /^(?:[ \t]+|>|[-+*][ \t]+|\d{1,9}[.)][ \t]+|#{1,6}[ \t]+|\[[ xX]\][ \t]+)/;

/** A setext heading underline or a dash rule, which a mark would turn into plain text. */
const UNDERLINE = /^[ \t]*(?:=+|-+)[ \t]*$/;

const LEFT_ALONE_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'HorizontalRule',
  'Table',
  'HTMLBlock',
  'LinkReference'
]);

/** Where a line's direction mark goes: right after its block markers. */
export function markOffset(lineText: string): number {
  let offset = 0;
  for (;;) {
    const marker = BLOCK_MARKER.exec(lineText.slice(offset));
    if (!marker) return offset;
    offset += marker[0].length;
  }
}

function markAt(lineText: string, offset: number): TextDirection | null {
  const char = lineText[offset];
  if (char === DIRECTION_MARK.rtl) return 'rtl';
  if (char === DIRECTION_MARK.ltr) return 'ltr';
  return null;
}

function isLeftAlone(state: EditorState, line: Line): boolean {
  if (UNDERLINE.test(line.text)) return true;
  const tree = ensureSyntaxTree(state, line.to, 50) ?? syntaxTree(state);
  // Past the indentation, because indented code only starts there.
  const start = line.from + line.text.search(/\S|$/);
  for (let node = tree.resolveInner(start, 1); ; node = node.parent) {
    if (LEFT_ALONE_NODES.has(node.name)) return true;
    if (!node.parent) return false;
  }
}

/** Lines touched by the selection. One that a range only reaches at column 0 is not. */
function selectedLines(state: EditorState): Line[] {
  const { doc, selection } = state;
  const numbers = new Set<number>();
  for (const range of selection.ranges) {
    const first = doc.lineAt(range.from);
    const last = doc.lineAt(range.to);
    const end = !range.empty && last.from === range.to && last.number > first.number
      ? last.number - 1
      : last.number;
    for (let n = first.number; n <= end; n++) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b).map((n) => doc.line(n));
}

/** The direction a line would have without its mark. */
function naturalDirection(doc: Text, line: Line, uiDirection: TextDirection): TextDirection {
  const offset = markOffset(line.text);
  const rest = line.text.slice(markAt(line.text, offset) ? offset + 1 : offset);
  return detectTextDirection(rest) ?? directionAbove(doc, line.number, uiDirection);
}

function changeForLine(
  doc: Text,
  line: Line,
  target: TextDirection,
  uiDirection: TextDirection
): ChangeSpec | null {
  const offset = markOffset(line.text);
  const pos = line.from + offset;
  const mark = markAt(line.text, offset);
  if (target === naturalDirection(doc, line, uiDirection)) {
    return mark ? { from: pos, to: pos + 1 } : null;
  }
  if (mark === target) return null;
  return { from: pos, to: mark ? pos + 1 : pos, insert: DIRECTION_MARK[target] };
}

/**
 * Flip the direction of the selected lines. All of them get the opposite of the
 * first line's direction, so a selection ends up uniform. A line that reaches
 * that direction on its own loses its mark, so a second press leaves the text
 * as it was. Returns null when no line can be changed.
 */
export function toggleLineDirection(
  state: EditorState,
  uiDirection: TextDirection
): TransactionSpec | null {
  const selected = selectedLines(state).filter((line) => !isLeftAlone(state, line));
  // A mark on a blank line between paragraphs would join them, so a multi-line
  // selection skips those. A lone empty line is where the user is about to type.
  const lines = selected.length > 1 ? selected.filter((line) => line.text.trim()) : selected;
  if (lines.length === 0) return null;

  const [first] = lines;
  const current =
    markAt(first.text, markOffset(first.text)) ??
    naturalDirection(state.doc, first, uiDirection);
  const target: TextDirection = current === 'rtl' ? 'ltr' : 'rtl';

  const specs = lines
    .map((line) => changeForLine(state.doc, line, target, uiDirection))
    .filter((spec) => spec !== null);
  const changes = state.changes(specs);
  // A caret at the mark's position has to land after it. Text typed in front of
  // the mark would take over as the line's first strong character.
  return { changes, selection: state.selection.map(changes, 1), userEvent: 'input' };
}

const ATOMIC_MARK = Decoration.mark({});

/** Arrow keys skip a mark, so moving along a line never takes a press that shows nothing. */
export const directionMarkAtomicRanges = EditorView.atomicRanges.of((view) => {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  let lastLine = -1;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (line.number > lastLine) {
        const offset = markOffset(line.text);
        if (markAt(line.text, offset)) {
          builder.add(line.from + offset, line.from + offset + 1, ATOMIC_MARK);
        }
        lastLine = line.number;
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
});
