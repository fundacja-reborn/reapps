import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { Strikethrough } from '@lezer/markdown';
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
    extensions: [markdown({ extensions: [Strikethrough] })],
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

  it('applies cm-lp-em on a single-character emphasis (regression: typing fresh)', () => {
    // Reproduces the user-typed flow: toolbar inserts `__`, user types `a`,
    // ending up with `_a_`. Cursor sits inside, so markers stay visible —
    // but the EM mark must still wrap the range so italic renders.
    const state = makeState('_a_', 2);
    const ranges = asRanges(buildDecorations(state));
    expect(classAt(ranges, 0, 3)).toBe('cm-lp-em');
    // Markers visible (cursor in range) — no HIDDEN ranges over them
    expect(hasHiddenRange(ranges, 0, 1)).toBe(false);
    expect(hasHiddenRange(ranges, 2, 3)).toBe(false);
  });

  it('hides ~~ markers around strikethrough when cursor is outside', () => {
    const state = makeState('~~strike~~ here', 14); // cursor in "here"
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 10)).toBe('cm-lp-strike');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(true);
    expect(hasHiddenRange(ranges, 8, 10)).toBe(true);
  });

  it('keeps ~~ visible when cursor is inside the strikethrough range', () => {
    const state = makeState('~~strike~~ here', 5); // cursor inside "strike"
    const ranges = asRanges(buildDecorations(state));

    expect(classAt(ranges, 0, 10)).toBe('cm-lp-strike');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(false);
    expect(hasHiddenRange(ranges, 8, 10)).toBe(false);
  });

  it('applies cm-lp-strike on a single-character strikethrough (regression: typing fresh)', () => {
    const state = makeState('~~a~~', 3);
    const ranges = asRanges(buildDecorations(state));
    expect(classAt(ranges, 0, 5)).toBe('cm-lp-strike');
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

describe('buildDecorations — fenced code blocks', () => {
  it('replaces a fenced block with a widget when cursor is outside', () => {
    const doc = '```js\nconst x = 1;\n```\n\nbody';
    const cursor = doc.length - 1; // cursor in "body"
    const state = makeState(doc, cursor);
    const ranges = asRanges(buildDecorations(state));

    const widgetRanges = ranges.filter((r) => r.hasWidget);
    expect(widgetRanges).toHaveLength(1);

    // Widget spans from line-start of opening fence to line-end of closing fence
    const fenceStart = 0;
    const fenceEnd = doc.indexOf('```\n\nbody') + 3; // end of closing ```
    expect(widgetRanges[0].from).toBe(fenceStart);
    expect(widgetRanges[0].to).toBe(fenceEnd);
  });

  it('renders raw with cm-lp-code-line decorations when cursor is inside the block', () => {
    const doc = '```js\nconst x = 1;\n```';
    const state = makeState(doc, 10); // cursor in "const"
    const ranges = asRanges(buildDecorations(state));

    // No widget when cursor inside
    expect(ranges.filter((r) => r.hasWidget)).toHaveLength(0);

    // Three lines: opening fence, body, closing fence — all decorated
    const lineDecos = ranges.filter((r) => r.spec.class?.includes('cm-lp-code-line'));
    expect(lineDecos.length).toBe(3);
    expect(lineDecos[0].spec.class).toContain('cm-lp-code-line-first');
    expect(lineDecos[2].spec.class).toContain('cm-lp-code-line-last');
  });

  it('handles a fenced block with no info string', () => {
    const doc = '```\nplain code\n```\n\nbody';
    const state = makeState(doc, doc.length - 1); // cursor in "body"
    const ranges = asRanges(buildDecorations(state));

    const widgets = ranges.filter((r) => r.hasWidget);
    expect(widgets).toHaveLength(1);
  });

  it('handles a single-line fenced block (no body)', () => {
    const doc = '```js\n```\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    expect(ranges.filter((r) => r.hasWidget)).toHaveLength(1);
  });

  it('does NOT descend into the block — no inline marks emitted inside', () => {
    // Bold-looking syntax inside a code block should NOT generate cm-lp-strong
    const doc = '```\n**not bold**\n```\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    const strongRanges = ranges.filter((r) => r.spec.class === 'cm-lp-strong');
    expect(strongRanges).toHaveLength(0);
  });

  it('coexists with other block decorations on the surrounding document', () => {
    const doc = '# Title\n\n```js\nx = 1;\n```\n\nmore';
    const state = makeState(doc, doc.length - 1); // cursor in "more"
    const ranges = asRanges(buildDecorations(state));

    // Heading line decoration still applied
    expect(classAt(ranges, 0, 0)).toBe('cm-lp-h1-line');
    // Fenced code widget present
    expect(ranges.filter((r) => r.hasWidget)).toHaveLength(1);
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
