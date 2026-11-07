import { describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state';
import { markOffset, toggleLineDirection } from './direction-mark';

const RLM = String.fromCodePoint(0x200f);
const LRM = String.fromCodePoint(0x200e);

function stateOf(doc: string, ...ranges: SelectionRange[]) {
  return EditorState.create({
    doc,
    selection: ranges.length ? EditorSelection.create(ranges) : undefined,
    extensions: [markdown({ base: markdownLanguage }), EditorState.allowMultipleSelections.of(true)]
  });
}

function press(state: EditorState, ui: 'ltr' | 'rtl' = 'rtl'): EditorState {
  const spec = toggleLineDirection(state, ui);
  return spec ? state.update(spec).state : state;
}

const text = (state: EditorState) => state.doc.toString();

describe('markOffset', () => {
  it('is 0 for a plain paragraph', () => {
    expect(markOffset('re/notes')).toBe(0);
  });

  it('goes past block markers', () => {
    expect(markOffset('# Title')).toBe(2);
    expect(markOffset('### Title')).toBe(4);
    expect(markOffset('- item')).toBe(2);
    expect(markOffset('12. item')).toBe(4);
    expect(markOffset('3) item')).toBe(3);
    expect(markOffset('> quote')).toBe(2);
  });

  it('goes past task boxes, nesting and indentation', () => {
    expect(markOffset('- [ ] task')).toBe(6);
    expect(markOffset('* [x] task')).toBe(6);
    expect(markOffset('    - item')).toBe(6);
    expect(markOffset('> - item')).toBe(4);
  });

  it('does not take a hashtag or a bold marker for a block marker', () => {
    expect(markOffset('#tag')).toBe(0);
    expect(markOffset('**bold**')).toBe(0);
  });
});

describe('toggleLineDirection', () => {
  it('turns a line that starts with a Latin word right to left', () => {
    expect(text(press(stateOf('re/notes هو تطبيق')))).toBe(`${RLM}re/notes هو تطبيق`);
  });

  it('turns an Arabic line left to right', () => {
    expect(text(press(stateOf('هو تطبيق')))).toBe(`${LRM}هو تطبيق`);
  });

  it('leaves the text as it was after a second press', () => {
    const doc = 're/notes هو تطبيق';
    expect(text(press(press(stateOf(doc))))).toBe(doc);
  });

  it('puts the mark after the block marker', () => {
    expect(text(press(stateOf('# re/notes')))).toBe(`# ${RLM}re/notes`);
    expect(text(press(stateOf('- re/notes')))).toBe(`- ${RLM}re/notes`);
    expect(text(press(stateOf('- [ ] re/notes')))).toBe(`- [ ] ${RLM}re/notes`);
    expect(text(press(stateOf('> re/notes')))).toBe(`> ${RLM}re/notes`);
  });

  it('keeps the caret after the mark on an empty line', () => {
    const state = press(stateOf(''), 'rtl');
    expect(text(state)).toBe(LRM);
    expect(state.selection.main.head).toBe(1);
  });

  it('keeps the caret after the mark at the start of a line', () => {
    const state = press(stateOf('re/notes'));
    expect(state.selection.main.head).toBe(1);
  });

  it('keeps the caret on its letter when the mark goes in front of it', () => {
    const state = press(stateOf('re/notes', EditorSelection.cursor(3)));
    expect(state.selection.main.head).toBe(4);
  });

  it('takes an empty line direction from the text above', () => {
    const doc = 'hello\n';
    const state = stateOf(doc, EditorSelection.cursor(doc.length));
    expect(text(press(state, 'rtl'))).toBe(`hello\n${RLM}`);
  });

  it('gives every selected line the opposite of the first line', () => {
    const doc = 'one\nاثنان\nthree';
    const state = press(stateOf(doc, EditorSelection.range(0, doc.length)));
    expect(text(state)).toBe(`${RLM}one\nاثنان\n${RLM}three`);
  });

  it('flips a whole selection back with a second press', () => {
    const doc = 'one\nاثنان\nthree';
    const once = press(stateOf(doc, EditorSelection.range(0, doc.length)));
    expect(text(press(once))).toBe(`one\n${LRM}اثنان\nthree`);
  });

  it('skips blank lines of a selection, which would join the paragraphs', () => {
    const doc = 'one\n\ntwo';
    const state = press(stateOf(doc, EditorSelection.range(0, doc.length)));
    expect(text(state)).toBe(`${RLM}one\n\n${RLM}two`);
  });

  it('does not touch a line the selection only reaches at its start', () => {
    const state = press(stateOf('one\ntwo', EditorSelection.range(0, 4)));
    expect(text(state)).toBe(`${RLM}one\ntwo`);
  });

  it('covers every cursor of a multiple selection', () => {
    const state = press(stateOf('one\ntwo', EditorSelection.cursor(1), EditorSelection.cursor(5)));
    expect(text(state)).toBe(`${RLM}one\n${RLM}two`);
  });

  it('drops a mark once the line reaches that direction on its own', () => {
    expect(text(press(stateOf(`${LRM}هو`)))).toBe('هو');
  });

  it('replaces a mark that points the other way', () => {
    const doc = `one\n${LRM}two`;
    const state = press(stateOf(doc, EditorSelection.range(0, doc.length)));
    expect(text(state)).toBe(`${RLM}one\n${RLM}two`);
  });

  it.each([
    ['a fenced code block', '```\ncode\n```', 5],
    ['indented code', '    code', 5],
    ['a table', '| a | b |\n|---|---|\n| 1 | 2 |', 2],
    ['a dash rule', '---', 0],
    ['a star rule', '***', 0],
    ['a setext underline', 'Title\n=====', 7],
    ['a link reference', '[a]: https://reapps.eu', 0]
  ])('leaves %s alone', (_name, doc, cursor) => {
    const state = stateOf(doc, EditorSelection.cursor(cursor));
    expect(toggleLineDirection(state, 'rtl')).toBeNull();
  });
});
