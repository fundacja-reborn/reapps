import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import type { DecorationSet } from '@codemirror/view';
import { buildDecorations, isAnySelectionInRange } from './decorations';

interface DecoSpec {
  class?: string;
  widget?: unknown;
}

interface DecoRange {
  from: number;
  to: number;
  spec: DecoSpec;
  hasWidget: boolean;
  isHidden: boolean;
}

function makeState(doc: string, cursorPos = 0) {
  return EditorState.create({
    doc,
    extensions: [markdown()],
    selection: { anchor: cursorPos, head: cursorPos }
  });
}

function asRanges(set: DecorationSet): DecoRange[] {
  const out: DecoRange[] = [];
  const iter = set.iter();
  while (iter.value !== null) {
    const spec = (iter.value as { spec?: DecoSpec }).spec ?? {};
    out.push({
      from: iter.from,
      to: iter.to,
      spec,
      hasWidget: 'widget' in spec && spec.widget !== undefined,
      isHidden: !spec.class && !('widget' in spec) && iter.from !== iter.to
    });
    iter.next();
  }
  return out;
}

function classAt(ranges: DecoRange[], from: number, to: number): string | undefined {
  return ranges.find((r) => r.from === from && r.to === to)?.spec.class;
}

function hasHiddenRange(ranges: DecoRange[], from: number, to: number): boolean {
  return ranges.some((r) => r.from === from && r.to === to && r.isHidden);
}

describe('isAnySelectionInRange', () => {
  it('detects when cursor sits inside the range', () => {
    const state = makeState('# Hello', 3);
    expect(isAnySelectionInRange(state, 0, 7)).toBe(true);
  });

  it('detects boundary overlap (inclusive)', () => {
    const state = makeState('# Hello', 7);
    expect(isAnySelectionInRange(state, 0, 7)).toBe(true);
  });

  it('returns false when cursor is on a different line', () => {
    const state = makeState('# Hello\nworld', 10);
    expect(isAnySelectionInRange(state, 0, 7)).toBe(false);
  });
});

describe('buildDecorations — headings', () => {
  it('hides "# " marker when cursor is on a different line and styles the heading line', () => {
    const state = makeState('# Title\n\nbody text', 12); // cursor in "body text"
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 0)).toBe('cm-lp-h1-line');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(true);
  });

  it('keeps the "# " marker visible when cursor is on the heading line', () => {
    const state = makeState('# Title\n\nbody', 3); // cursor inside "Title"
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 0)).toBe('cm-lp-h1-line');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(false);
  });

  it.each([
    [1, '# H', 'cm-lp-h1-line'],
    [2, '## H', 'cm-lp-h2-line'],
    [3, '### H', 'cm-lp-h3-line'],
    [4, '#### H', 'cm-lp-h4-line'],
    [5, '##### H', 'cm-lp-h5-line'],
    [6, '###### H', 'cm-lp-h6-line']
  ])('applies the cm-lp-h%i-line class to heading level %i', (_level, doc, cls) => {
    const state = makeState(`${doc}\n\nbody`, doc.length + 3); // cursor in body
    const ranges = asRanges(buildDecorations(state));
    expect(classAt(ranges, 0, 0)).toBe(cls);
  });
});

describe('buildDecorations — strong/emphasis/inline code', () => {
  it('hides ** markers around bold when cursor is outside', () => {
    const state = makeState('**bold** here', 12); // cursor on "here"
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 8)).toBe('cm-lp-strong');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(true);
    expect(hasHiddenRange(ranges, 6, 8)).toBe(true);
  });

  it('keeps ** visible when cursor is inside the bold range', () => {
    const state = makeState('**bold** here', 4); // cursor inside "bold"
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 8)).toBe('cm-lp-strong');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(false);
    expect(hasHiddenRange(ranges, 6, 8)).toBe(false);
  });

  it('hides _ markers around italic when cursor is outside', () => {
    const state = makeState('_italic_ here', 12);
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 8)).toBe('cm-lp-em');
    expect(hasHiddenRange(ranges, 0, 1)).toBe(true);
    expect(hasHiddenRange(ranges, 7, 8)).toBe(true);
  });

  it('hides ` markers around inline code when cursor is outside', () => {
    const state = makeState('`code` here', 10);
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 6)).toBe('cm-lp-code');
    expect(hasHiddenRange(ranges, 0, 1)).toBe(true);
    expect(hasHiddenRange(ranges, 5, 6)).toBe(true);
  });
});

describe('buildDecorations — links', () => {
  it('replaces a [text](url) link with a widget when cursor is outside', () => {
    const doc = '[example](https://example.com) trailing';
    const state = makeState(doc, doc.length - 1); // cursor in "trailing"
    const ranges = asRanges(buildDecorations(state));

    const linkRange = ranges.find((r) => r.from === 0 && r.to === 30);
    expect(linkRange).toBeDefined();
    expect(linkRange?.hasWidget).toBe(true);
  });

  it('does NOT replace the link when cursor is inside it', () => {
    const doc = '[example](https://example.com) trailing';
    const state = makeState(doc, 5); // cursor inside [example]
    const ranges = asRanges(buildDecorations(state));

    const widgetRanges = ranges.filter((r) => r.hasWidget);
    expect(widgetRanges).toHaveLength(0);
  });

  it('replaces a note:UUID link with a widget', () => {
    const doc = '[Note](note:00000000-0000-0000-0000-000000000000)';
    const state = makeState(doc + '\nbody', doc.length + 3);
    const ranges = asRanges(buildDecorations(state));

    const widgetRanges = ranges.filter((r) => r.hasWidget);
    expect(widgetRanges).toHaveLength(1);
    expect(widgetRanges[0].from).toBe(0);
    expect(widgetRanges[0].to).toBe(doc.length);
  });
});

describe('buildDecorations — blockquote and lists', () => {
  it('hides "> " on each blockquote line when cursor is elsewhere', () => {
    const doc = '> quote line\n\nbody';
    const state = makeState(doc, doc.length - 1); // cursor in "body"
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 0)).toBe('cm-lp-blockquote-line');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(true);
  });

  it('keeps "> " visible on the line containing the cursor', () => {
    const state = makeState('> quote line\n\nbody', 5); // cursor inside "quote"
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 0)).toBe('cm-lp-blockquote-line');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(false);
  });

  it('hides "- " on a bullet list item when cursor is elsewhere', () => {
    const doc = '- item one\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 0)).toBe('cm-lp-bullet-line');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(true);
  });

  it('keeps the marker visible for ordered lists (number is meaningful)', () => {
    const doc = '1. item one\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 0)).toBe('cm-lp-ordered-line');
    // No hidden range over the "1. " marker
    const hiddenAtMark = ranges.find((r) => r.from === 0 && r.isHidden);
    expect(hiddenAtMark).toBeUndefined();
  });
});

describe('buildDecorations — empty / no markdown', () => {
  it('returns no decorations for an empty document', () => {
    const state = makeState('', 0);
    const ranges = asRanges(buildDecorations(state));
    expect(ranges).toHaveLength(0);
  });

  it('returns no decorations for plain text without markdown', () => {
    const state = makeState('just plain text without any markup', 5);
    const ranges = asRanges(buildDecorations(state));
    expect(ranges).toHaveLength(0);
  });
});
