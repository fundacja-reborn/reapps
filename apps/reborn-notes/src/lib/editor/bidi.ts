/**
 * Per-line text direction for the note editor.
 *
 * A note's direction is a property of its content, not of the UI locale: an
 * Arabic or Hebrew paragraph in an English UI must still render (and move the
 * caret) right-to-left, and a line of code in an Arabic UI must stay LTR.
 * A line with text gets `dir="auto"`, so the browser resolves its direction
 * from the first strong character (Markdown markers like `#`, `-`, `>` are
 * neutral and do not count). `perLineTextDirection` makes CodeMirror read
 * that resolved direction per line for cursor motion and selection, instead
 * of assuming the content element's direction for the whole document.
 *
 * A line with no strong character has nothing for `dir="auto"` to go on, and
 * the browser falls back to LTR. That would put the caret of an empty line on
 * the left and make it jump to the right on the first Arabic letter (#482), so
 * such a line carries an explicit direction instead: the one of the nearest
 * line above that has text, or the UI direction at the top of a note.
 *
 * The user can override a line's direction: see `direction-mark.ts`.
 *
 * A click or Home/End on the visual edge of a mixed-direction line lands on
 * the logical edge of the line: see `bidi-line-edge.ts` (#539).
 *
 * Live Preview's list / quote geometry uses logical properties
 * (`padding-inline-start`, ...) so it mirrors on RTL lines (theme.ts).
 */
import { RangeSetBuilder, type Extension, type Text } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';
import { get } from 'svelte/store';
import { detectTextDirection, textDirection, type TextDirection } from '@reborn/i18n';
import { lineEdgeCursor } from './bidi-line-edge';

/**
 * How far up a line without text looks for a direction. A longer gap means the
 * paragraph above is no real context anymore, and the bound keeps a note made
 * of thousands of blank lines cheap to decorate.
 */
const MAX_LOOKBACK_LINES = 100;

/** The direction of the nearest line above with text, or the UI direction. */
export function directionAbove(
  doc: Text,
  lineNumber: number,
  uiDirection: TextDirection
): TextDirection {
  const lastLine = Math.max(1, lineNumber - MAX_LOOKBACK_LINES);
  for (let n = lineNumber - 1; n >= lastLine; n--) {
    const direction = detectTextDirection(doc.line(n).text);
    if (direction) return direction;
  }
  return uiDirection;
}

/** The `dir` of a line: `auto` when it has text, else the direction around it. */
export function lineDirection(
  doc: Text,
  lineNumber: number,
  uiDirection: TextDirection
): TextDirection | 'auto' {
  if (detectTextDirection(doc.line(lineNumber).text)) return 'auto';
  return directionAbove(doc, lineNumber, uiDirection);
}

const lineDecorations = {
  auto: Decoration.line({ attributes: { dir: 'auto' } }),
  ltr: Decoration.line({ attributes: { dir: 'ltr' } }),
  rtl: Decoration.line({ attributes: { dir: 'rtl' } })
};

function buildLineDirections(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const uiDirection = get(textDirection);
  let lastLine = -1;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      // Visible ranges can share a line (folded / replaced spans); add each
      // line once, in order, as RangeSetBuilder requires.
      if (line.number > lastLine) {
        const direction = lineDirection(doc, line.number, uiDirection);
        builder.add(line.from, line.from, lineDecorations[direction]);
        lastLine = line.number;
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const lineDirections = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLineDirections(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildLineDirections(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

/**
 * Per-line bidi: a `dir` on every line, per-line direction reads, and the
 * cursor and the ends of a mouse selection kept on the logical edge of a line.
 * Call once per editor: that last part is tied to the view it runs in.
 */
export function bidiLines(): Extension {
  return [EditorView.perLineTextDirection.of(true), lineDirections, lineEdgeCursor()];
}
