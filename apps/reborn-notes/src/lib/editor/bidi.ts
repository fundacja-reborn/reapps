/**
 * Per-line text direction for the note editor.
 *
 * A note's direction is a property of its content, not of the UI locale: an
 * Arabic or Hebrew paragraph in an English UI must still render (and move the
 * caret) right-to-left, and a line of code in an Arabic UI must stay LTR.
 * Every visible line gets `dir="auto"`, so the browser resolves its direction
 * from the first strong character (Markdown markers like `#`, `-`, `>` are
 * neutral and do not count). `perLineTextDirection` makes CodeMirror read
 * that resolved direction per line for cursor motion and selection, instead
 * of assuming the content element's direction for the whole document.
 *
 * Live Preview's list / quote geometry uses logical properties
 * (`padding-inline-start`, ...) so it mirrors on RTL lines (theme.ts).
 */
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';

const autoDirection = Decoration.line({ attributes: { dir: 'auto' } });

function buildLineDirections(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  let lastLine = -1;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      // Visible ranges can share a line (folded / replaced spans); add each
      // line once, in order, as RangeSetBuilder requires.
      if (line.number > lastLine) {
        builder.add(line.from, line.from, autoDirection);
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

/** Per-line bidi: `dir="auto"` on every line + per-line direction reads. */
export function bidiLines(): Extension {
  return [EditorView.perLineTextDirection.of(true), lineDirections];
}
