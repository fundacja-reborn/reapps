// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { lineEdgeCursor } from './bidi-line-edge';

// The geometry is tested in bidi-line-edge.test.ts on measured layouts (jsdom
// has no layout). This file only checks how the stand-in is put on the view.
describe('lineEdgeCursor: posAtCoords on the view', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('puts its own posAtCoords on the editor it runs in', () => {
    view = new EditorView({ doc: 'text', extensions: lineEdgeCursor(), parent: document.body });
    expect(Object.hasOwn(view, 'posAtCoords')).toBe(true);
    expect(view.posAtCoords).not.toBe(EditorView.prototype.posAtCoords);
  });

  it('leaves an editor without the extension alone', () => {
    view = new EditorView({ doc: 'text', parent: document.body });
    expect(Object.hasOwn(view, 'posAtCoords')).toBe(false);
  });

  it('gives the method of the class back when the editor is destroyed', () => {
    const editor = new EditorView({
      doc: 'text',
      extensions: lineEdgeCursor(),
      parent: document.body
    });
    editor.destroy();
    expect(Object.hasOwn(editor, 'posAtCoords')).toBe(false);
    expect(editor.posAtCoords).toBe(EditorView.prototype.posAtCoords);
  });
});
