/**
 * Keep the caret and the ends of a mouse selection on the logical edge of a
 * line when the user aims at its visual edge (#539).
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
 * A selection dragged or shift-clicked with the mouse has the same problem at
 * each of its ends: dragged from the Arabic text to the left edge of the line
 * above, it stopped in front of the number and left it out. A range keeps no
 * side for its ends, so the side is asked from the pointer itself (see
 * `pointerRange`). Which of the two positions an end on that spot means
 * depends on the other end: seen from inside the run it is the run's edge,
 * seen from anywhere else it is the edge of the line.
 *
 * Everything here goes through the public API (`posAndSideAtCoords`,
 * `bidiSpans`, `textDirectionAt`, a transaction filter). Nothing of the
 * editor's own mouse handling is replaced. Should CodeMirror start returning
 * the line edge for that spot itself, the filter no longer finds anything to
 * move and can be deleted.
 */
import { EditorSelection, EditorState, type Extension, type Line } from '@codemirror/state';
import { Direction, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

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

/** A run that is laid out against the direction of its line. */
function facesOut(run: BidiRun, rtl: boolean): boolean {
  return run.to > run.from && run.level % 2 !== (rtl ? 1 : 0);
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
  // A run against the line is laid out backwards: the one at the visual end
  // of the line has its start there, the one at the visual start its end.
  const onEdge = (run: BidiRun) =>
    facesOut(run, rtl) && (bidiLevel === null || bidiLevel === run.level);

  const last = runs[runs.length - 1];
  if (assoc > 0 && index === last.from && onEdge(last)) return 1;
  const first = runs[0];
  if (assoc < 0 && index === first.to && onEdge(first)) return -1;
  return 0;
}

/**
 * One end of a selection as the pointer gave it: an offset into its line and
 * the side of that position the pointer was on (`0` when not known).
 */
export interface LineSpot {
  readonly index: number;
  readonly assoc: number;
}

/**
 * Where an end of a mouse selection belongs when it lies on a visual edge of
 * its line: the spot to use instead, or `null` to leave the end where it is.
 *
 * `end` is the end in question. `other` is the opposite end of the selection
 * as an offset into the same line, or `null` when it is in another line.
 *
 * The spot at the visual edge stands for two positions. Seen from inside the
 * run that lies there, it is the edge of that run: a drag from "3" in
 * `عربي 12345` to the left edge covers "12". Seen from anywhere else it is
 * the edge of the line: a drag from the Arabic text to the left edge covers
 * the rest of the line, number included.
 */
export function selectionEndOnLineEdge(
  runs: readonly BidiRun[],
  rtl: boolean,
  lineLength: number,
  end: LineSpot,
  other: LineSpot | null
): LineSpot | null {
  const edge = edgeSpot(runs, rtl, lineLength, end);
  if (!edge) return null;
  const run = edge > 0 ? runs[runs.length - 1] : runs[0];
  // The run's end on the edge of the line, and its end inside the line.
  const outer = edge > 0 ? run.from : run.to;
  const inner = edge > 0 ? run.to : run.from;
  const lineEdge = edge > 0 ? lineLength : 0;

  let inside = false;
  if (other && edgeSpot(runs, rtl, lineLength, other) !== edge) {
    const low = Math.min(outer, inner);
    const high = Math.max(outer, inner);
    inside = other.index === inner || (other.index > low && other.index < high);
  }
  const index = inside ? outer : lineEdge;
  // Either way the side is the edge's own: into the run from its outer end,
  // out of the line from the line's edge (the form cursor motion expects).
  return index === end.index ? null : { index, assoc: edge };
}

/**
 * Like `visualLineEdge`, and also true for the form this module and cursor
 * motion give such a cursor: on the edge of the line, facing out of it. An
 * earlier click leaves the anchor of a shift-click in that form.
 */
function edgeSpot(
  runs: readonly BidiRun[],
  rtl: boolean,
  lineLength: number,
  spot: LineSpot
): -1 | 0 | 1 {
  const onRun = visualLineEdge(runs, rtl, spot.index, spot.assoc);
  if (onRun || !runs.length) return onRun;
  if (spot.assoc > 0 && spot.index === lineLength && facesOut(runs[runs.length - 1], rtl)) return 1;
  if (spot.assoc < 0 && spot.index === 0 && facesOut(runs[0], rtl)) return -1;
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

/** A document position and the side of it the pointer was on. */
interface PointerSpot {
  pos: number;
  assoc: number;
}

/** What is known about the mouse selection in progress. */
interface PointerDrag {
  /** Where the selection is anchored; mapped through document changes. */
  anchor: PointerSpot;
  /** Last pointer position, in client coordinates. */
  x: number;
  y: number;
}

function resolveEnd(view: EditorView, end: PointerSpot, other: PointerSpot): PointerSpot | null {
  const line: Line = view.state.doc.lineAt(end.pos);
  const sameLine = other.pos >= line.from && other.pos <= line.to;
  const spot = selectionEndOnLineEdge(
    view.bidiSpans(line),
    view.textDirectionAt(line.from) === Direction.RTL,
    line.length,
    { index: end.pos - line.from, assoc: end.assoc },
    sameLine ? { index: other.pos - line.from, assoc: other.assoc } : null
  );
  return spot && { pos: line.from + spot.index, assoc: spot.assoc };
}

/**
 * The main range of a mouse selection with its ends moved off the visual line
 * edges, or `null` when there is nothing to move (or the selection is not the
 * plain one this module understands, see `lineEdgeCursor`).
 */
function pointerRange(
  view: EditorView,
  selection: EditorSelection,
  drag: PointerDrag
): EditorSelection | null {
  const range = selection.main;
  // The side of the head is not in the range, so ask where the pointer is.
  // If that is not where the editor put the head (word or line selection, a
  // custom selection style), leave the selection alone.
  const head: PointerSpot = view.posAndSideAtCoords({ x: drag.x, y: drag.y }, false);
  if (head.pos !== range.head || drag.anchor.pos !== range.anchor) return null;

  const newAnchor = resolveEnd(view, drag.anchor, head);
  const newHead = resolveEnd(view, head, drag.anchor);
  if (!newAnchor && !newHead) return null;
  const anchor = newAnchor ?? drag.anchor;
  const end = newHead ?? head;
  const moved =
    anchor.pos === end.pos
      ? EditorSelection.cursor(end.pos, end.assoc)
      : EditorSelection.range(anchor.pos, end.pos);
  return selection.replaceRange(moved, selection.mainIndex);
}

/**
 * Moves a cursor set by the user (click, Home/End, vertical motion) from the
 * visual edge of a mixed-direction line to the logical edge of that line, and
 * does the same for the ends of a selection made with the mouse (drag from a
 * single click, shift-click).
 *
 * The filter needs the view for the line's direction and bidi runs, so the
 * returned extension belongs to one editor: call this once per `EditorState`.
 */
export function lineEdgeCursor(): Extension {
  let view: EditorView | null = null;
  let drag: PointerDrag | null = null;

  const trackView = ViewPlugin.define((editorView) => {
    view = editorView;
    const doc = editorView.dom.ownerDocument;

    // Capture phase, so the pointer position is known before the editor's own
    // handlers turn the same event into a selection.
    function onUp() {
      drag = null;
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseup', onUp, true);
    }
    function onMove(event: MouseEvent) {
      // No button down: the release happened where no event reached us.
      if (event.buttons === 0) return onUp();
      if (drag) {
        drag.x = event.clientX;
        drag.y = event.clientY;
      }
    }
    function onDown(event: MouseEvent) {
      onUp();
      // Only the plain selection: a double or triple click selects by word or
      // line, and those already reach past the edge of the run.
      if (event.button !== 0 || event.detail !== 1) return;
      const coords = { x: event.clientX, y: event.clientY };
      const main = editorView.state.selection.main;
      // A shift-click keeps the anchor of the selection there was; only a
      // cursor says which side it is on.
      const anchor: PointerSpot = event.shiftKey
        ? { pos: main.anchor, assoc: main.empty ? main.assoc : 0 }
        : editorView.posAndSideAtCoords(coords, false);
      drag = { anchor, ...coords };
      doc.addEventListener('mousemove', onMove, true);
      doc.addEventListener('mouseup', onUp, true);
    }
    editorView.dom.addEventListener('mousedown', onDown, true);

    return {
      update(update: ViewUpdate) {
        if (drag && update.docChanged) {
          drag.anchor.pos = update.changes.mapPos(drag.anchor.pos);
        }
      },
      destroy() {
        onUp();
        editorView.dom.removeEventListener('mousedown', onDown, true);
        view = null;
      }
    };
  });

  const snapCursor = EditorState.transactionFilter.of((tr) => {
    if (!view || tr.startState !== view.state) return tr;
    if (!tr.selection || tr.docChanged || !tr.isUserEvent('select')) return tr;
    const fromPointer =
      drag && tr.isUserEvent('select.pointer') ? pointerRange(view, tr.selection, drag) : null;
    const selection = fromPointer ?? snapToLineEdges(view, tr.selection);
    return selection === tr.selection ? tr : [tr, { selection }];
  });

  return [trackView, snapCursor];
}
