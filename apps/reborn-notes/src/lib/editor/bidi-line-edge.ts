/**
 * Keep the caret on the logical edge of a line when the user aims at its
 * visual edge (#539).
 *
 * In a line of mixed direction the visual end can belong to a run that goes
 * against the line. `عربي 12345` is a right-to-left line whose left edge, its
 * visual end, is the "1" of a left-to-right number. That one spot stands for
 * two document positions: the end of the line (after "5", where the text
 * continues) and the start of the number (before "1"). CodeMirror resolves a
 * click on that spot, and the End key, to the start of the number. The browser
 * then draws its caret for that position on the other side of the number, and
 * typing goes in front of the number instead of after it. A native text field
 * picks the end of the line, and so does the browser's own tap handling on a
 * phone, which is why the bug only shows with a mouse and a keyboard.
 *
 * So a cursor that CodeMirror put on the outer edge of such a run, facing into
 * the run, moves to the edge of the line. Since @codemirror/view 6.43.13 that
 * is also the position cursor motion itself uses for the spot, so the arrow
 * keys carry on from it correctly.
 *
 * Only cursors are corrected. A selection range keeps no side for its ends,
 * and when the drag started inside the run, the run's edge is exactly where
 * the selection has to stop.
 */
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { Direction, EditorView, ViewPlugin } from '@codemirror/view';

/**
 * A run of text in one direction, as `EditorView.bidiSpans` returns them:
 * offsets into the line, listed in visual order from the line's start side.
 */
export interface BidiRun {
  readonly from: number;
  readonly to: number;
  /** Bidi embedding level: even runs left to right, odd right to left. */
  readonly level: number;
}

/**
 * Tells whether a cursor sits on a visual edge of its line while its document
 * position is somewhere inside the line: `1` for the end of the line, `-1`
 * for the start, `0` for any other cursor.
 *
 * `assoc` is the side the cursor belongs to (`SelectionRange.assoc`); a
 * cursor without a side is never on an edge it does not name.
 */
export function visualLineEdge(
  runs: readonly BidiRun[],
  rtl: boolean,
  index: number,
  assoc: number,
  bidiLevel: number | null = null
): -1 | 0 | 1 {
  if (!assoc || !runs.length) return 0;
  const lineParity = rtl ? 1 : 0;
  // A run against the line is laid out backwards: the one at the visual end
  // of the line has its start there, the one at the visual start its end.
  const facesOut = (run: BidiRun) =>
    run.to > run.from &&
    run.level % 2 !== lineParity &&
    (bidiLevel === null || bidiLevel === run.level);

  const last = runs[runs.length - 1];
  if (assoc > 0 && index === last.from && facesOut(last)) return 1;
  const first = runs[0];
  if (assoc < 0 && index === first.to && facesOut(first)) return -1;
  return 0;
}

function snapToLineEdges(view: EditorView, selection: EditorSelection): EditorSelection {
  let snapped = false;
  const ranges = selection.ranges.map((range) => {
    if (!range.empty || !range.assoc) return range;
    const line = view.state.doc.lineAt(range.head);
    const edge = visualLineEdge(
      view.bidiSpans(line),
      view.textDirectionAt(line.from) === Direction.RTL,
      range.head - line.from,
      range.assoc,
      range.bidiLevel
    );
    if (!edge) return range;
    snapped = true;
    // The side points out of the line, the form cursor motion expects there.
    return EditorSelection.cursor(
      edge > 0 ? line.to : line.from,
      edge,
      undefined,
      range.goalColumn
    );
  });
  return snapped ? EditorSelection.create(ranges, selection.mainIndex) : selection;
}

/**
 * Moves a cursor set by the user (click, Home/End, vertical motion) from the
 * visual edge of a mixed-direction line to the logical edge of that line.
 *
 * The filter needs the view for the line's direction and bidi runs, so the
 * returned extension belongs to one editor: call this once per `EditorState`.
 */
export function lineEdgeCursor(): Extension {
  let view: EditorView | null = null;

  const trackView = ViewPlugin.define((editorView) => {
    view = editorView;
    return {
      destroy() {
        view = null;
      }
    };
  });

  const snapCursor = EditorState.transactionFilter.of((tr) => {
    if (!view || tr.startState !== view.state) return tr;
    if (!tr.selection || tr.docChanged || !tr.isUserEvent('select')) return tr;
    const selection = snapToLineEdges(view, tr.selection);
    return selection === tr.selection ? tr : [tr, { selection }];
  });

  return [trackView, snapCursor];
}
