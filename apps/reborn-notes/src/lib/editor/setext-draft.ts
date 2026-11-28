/**
 * An underlined (Setext) heading whose underline is still being typed.
 *
 * By CommonMark, a lone `-` or `=` on the line right under a paragraph is the
 * underline of a heading: `Text\n-` is an H2 and `Text\n=` an H1, in the editor's
 * parser and in the rendered preview alike. While the caret is still on that
 * line, though, the user is almost always starting something else: a list item
 * (`-` and `- ` come before `- item`, which ends the heading) or a line of text.
 * The next character decides. Until it does, the editor keeps showing the
 * paragraph above as a paragraph instead of flashing it, and every line of it,
 * into a heading: no heading style in Live Preview, no fold button.
 *
 * Two or more marks (`--`, `---`, `===`) are an underline drawn on purpose and
 * stay a heading. Once the caret leaves the line, a lone mark is a heading too,
 * as it is in the preview.
 */
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/**
 * True when `node` is a Setext heading whose underline is a single `-` or `=`
 * and a caret is on that underline line.
 */
export function isDraftSetextHeading(state: EditorState, node: SyntaxNode): boolean {
  if (node.name !== 'SetextHeading1' && node.name !== 'SetextHeading2') return false;
  // The underline is the last child, after the inline content of the text.
  const underline = node.lastChild;
  if (!underline || underline.name !== 'HeaderMark' || underline.to - underline.from !== 1) {
    return false;
  }
  const line = state.doc.lineAt(underline.from);
  return state.selection.ranges.some((range) => range.head >= line.from && range.head <= line.to);
}
