/**
 * Pure logic for toggling an inline markdown wrap (`**`, `_`, `~~`, `` ` ``)
 * around a selected string. Shared by the CM6 editor toolbar (`wrapSelection`
 * in `NoteEditor.svelte`) and the Live Preview table cell editor
 * (`wrapCellSelection` in `live-preview/table-widget.ts`) so both apply
 * identical semantics — keeping them from drifting.
 *
 * Returns the replacement text plus the selection to leave behind, expressed as
 * offsets *relative to the start of the replaced range*. The caller adds its own
 * base offset (a doc position for CM6, a node offset for a contenteditable cell).
 */
export interface InlineWrapResult {
  /** Text to replace the selection with. */
  insert: string;
  /** Selection anchor within `insert`. */
  anchor: number;
  /** Selection head within `insert`. */
  head: number;
}

export function computeInlineWrap(selected: string, marker: string): InlineWrapResult {
  if (!selected) {
    // No selection: drop empty markers, caret between them to type into.
    return { insert: `${marker}${marker}`, anchor: marker.length, head: marker.length };
  }

  // Markdown emphasis delimiters must hug non-whitespace: per CommonMark's
  // flanking rule `** x **` renders literally, only `**x**` is bold. So any
  // leading/trailing whitespace caught in the selection stays OUTSIDE the
  // markers. Split it off and wrap only the trimmed core; this also makes
  // toggle-off work when the selection includes surrounding spaces.
  const leadingWs = (selected.match(/^\s*/) ?? [''])[0];
  const rest = selected.slice(leadingWs.length);
  const trailingWs = (rest.match(/\s*$/) ?? [''])[0];
  const core = rest.slice(0, rest.length - trailingWs.length);

  if (!core) {
    // Whitespace-only selection: nothing to emphasize. Keep the spaces, drop
    // empty markers in place, caret between them.
    const insert = `${leadingWs}${marker}${marker}${trailingWs}`;
    const anchor = leadingWs.length + marker.length;
    return { insert, anchor, head: anchor };
  }

  if (core.startsWith(marker) && core.endsWith(marker) && core.length > marker.length * 2) {
    // Already wrapped → toggle off.
    const unwrapped = core.slice(marker.length, -marker.length);
    const insert = `${leadingWs}${unwrapped}${trailingWs}`;
    const anchor = leadingWs.length;
    return { insert, anchor, head: anchor + unwrapped.length };
  }

  const insert = `${leadingWs}${marker}${core}${marker}${trailingWs}`;
  const anchor = leadingWs.length;
  return { insert, anchor, head: anchor + marker.length * 2 + core.length };
}
