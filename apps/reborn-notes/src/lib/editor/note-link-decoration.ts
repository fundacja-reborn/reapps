/**
 * CM6 ViewPlugin that decorates `[Title](note:UUID)` patterns in the editor
 * with a visual indicator (styled inline with a 📝 prefix).
 */
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Match `[any text](note:UUID)` — standard markdown link with note: scheme,
// with an optional `#heading-slug` anchor (`note:UUID#slug`).
const NOTE_LINK_RE =
  /\[([^\]]+)\]\(note:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:#[^)\s]+)?\)/gi;

const noteLinkMark = Decoration.mark({ class: 'cm-note-link' });

function buildDecorations(doc: {
  toString(): string;
  lineAt(pos: number): { from: number };
}): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = doc.toString();
  let match: RegExpExecArray | null;

  NOTE_LINK_RE.lastIndex = 0;
  while ((match = NOTE_LINK_RE.exec(text)) !== null) {
    builder.add(match.index, match.index + match[0].length, noteLinkMark);
  }

  return builder.finish();
}

export const noteLinkDecoration = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: {
      state: { doc: { toString(): string; length: number; lineAt(pos: number): { from: number } } };
    }) {
      this.decorations = buildDecorations(view.state.doc);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildDecorations(update.state.doc);
      }
    }
  },
  { decorations: (v) => v.decorations }
);
