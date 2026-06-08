import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { Strikethrough, Table, TaskList } from '@lezer/markdown';
import type { DecorationSet } from '@codemirror/view';
import { buildDecorations, isAnySelectionInRange, resolveListClickForward } from './decorations';
import { TableWidget } from './table-widget';
import { ImageWidget } from './image-widget';
import { TaskCheckboxWidget } from './widgets';

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
    extensions: [markdown({ extensions: [Strikethrough, Table, TaskList] })],
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

    const cls = classAt(ranges, 0, 0);
    expect(cls).toContain('cm-lp-bullet-line');
    expect(cls).toContain('cm-lp-bullet-d1');
    expect(hasHiddenRange(ranges, 0, 2)).toBe(true);
  });

  it('keeps the marker visible for ordered lists (number is meaningful)', () => {
    const doc = '1. item one\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    const cls = classAt(ranges, 0, 0);
    expect(cls).toContain('cm-lp-ordered-line');
    expect(cls).toContain('cm-lp-ordered-d1');
    // No hidden range over the "1. " marker
    const hiddenAtMark = ranges.find((r) => r.from === 0 && r.isHidden);
    expect(hiddenAtMark).toBeUndefined();
  });
});

describe('buildDecorations — nested list depth', () => {
  it('applies cm-lp-bullet-d1 to top-level bullets', () => {
    const doc = '- one\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));
    expect(classAt(ranges, 0, 0)).toContain('cm-lp-bullet-d1');
  });

  it('applies cm-lp-bullet-d2 to nested bullets and hides leading whitespace', () => {
    const doc = '- one\n- two\n    - 2.1\n\nbody';
    const cursor = doc.length - 1; // cursor in "body"
    const state = makeState(doc, cursor);
    const ranges = asRanges(buildDecorations(state));

    const nestedLineFrom = doc.indexOf('    - 2.1');
    expect(classAt(ranges, nestedLineFrom, nestedLineFrom)).toContain('cm-lp-bullet-d2');

    // Leading "    " (4 spaces) hidden when cursor outside the line
    const listMarkPos = doc.indexOf('- 2.1');
    expect(hasHiddenRange(ranges, nestedLineFrom, listMarkPos)).toBe(true);
  });

  it('applies cm-lp-bullet-d3 at depth 3', () => {
    const doc = '- a\n  - b\n    - c\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    const lineCFrom = doc.indexOf('    - c');
    expect(classAt(ranges, lineCFrom, lineCFrom)).toContain('cm-lp-bullet-d3');
  });

  it('renders deep nesting up to d12 and clamps anything past it', () => {
    // 13 levels deep — d1..d12 should each get their own depth class, and
    // the 13th should clamp to d12 (visual cap, see MAX_LIST_DEPTH).
    const lines: string[] = [];
    for (let i = 0; i < 13; i++) {
      lines.push(' '.repeat(i * 2) + `- ${i + 1}`);
    }
    const doc = lines.join('\n') + '\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    const line7From = doc.indexOf(' '.repeat(12) + '- 7');
    expect(classAt(ranges, line7From, line7From)).toContain('cm-lp-bullet-d7');

    const line12From = doc.indexOf(' '.repeat(22) + '- 12');
    expect(classAt(ranges, line12From, line12From)).toContain('cm-lp-bullet-d12');

    const line13From = doc.indexOf(' '.repeat(24) + '- 13');
    expect(classAt(ranges, line13From, line13From)).toContain('cm-lp-bullet-d12');
  });

  it('keeps leading whitespace HIDDEN even when cursor is on the nested line (deterministic geometry)', () => {
    // Showing the indent spaces on cursor-enter would shift the visible
    // content rightward by ~1em per 4 spaces in proportional Roboto, making
    // the user think they're editing at a deeper indent than they actually
    // are. The depth-class padding already communicates nesting visually.
    const doc = '- one\n  - two\n\nbody';
    const cursor = doc.indexOf('two'); // cursor on the nested line
    const state = makeState(doc, cursor);
    const ranges = asRanges(buildDecorations(state));

    const nestedLineFrom = doc.indexOf('  - two');
    const listMarkPos = doc.indexOf('- two');
    // Whitespace stays hidden
    expect(hasHiddenRange(ranges, nestedLineFrom, listMarkPos)).toBe(true);
    // But the marker `- ` IS revealed (cursor on line) — user can edit/delete it
    expect(hasHiddenRange(ranges, listMarkPos, listMarkPos + 2)).toBe(false);
  });

  it('handles ordered lists with depth-aware padding', () => {
    const doc = '1. a\n   1. b\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    const nestedLineFrom = doc.indexOf('   1. b');
    expect(classAt(ranges, nestedLineFrom, nestedLineFrom)).toContain('cm-lp-ordered-d2');

    // Ordered marker stays visible (number is meaningful content)
    const numberPos = doc.indexOf('1. b');
    const hasMarkerHidden = ranges.some((r) => r.from === numberPos && r.isHidden);
    expect(hasMarkerHidden).toBe(false);
  });

  it('handles mixed ordered → bullet nesting (depth counts both)', () => {
    const doc = '1. a\n   - b\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    const nestedLineFrom = doc.indexOf('   - b');
    expect(classAt(ranges, nestedLineFrom, nestedLineFrom)).toContain('cm-lp-bullet-d2');
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

describe('buildDecorations — tables', () => {
  const TABLE_DOC = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

  it('emits a single block-replace TableWidget covering the table', () => {
    // Cursor outside the table — but cursor position should not matter.
    const state = makeState(TABLE_DOC + '\nafter', TABLE_DOC.length + 3);
    const ranges = asRanges(buildDecorations(state));
    const tableRanges = ranges.filter(
      (r) => r.hasWidget && r.spec.widget instanceof TableWidget
    );
    expect(tableRanges).toHaveLength(1);
    // Should span at least to the end of the last body row line.
    expect(tableRanges[0].from).toBe(0);
    expect(tableRanges[0].to).toBeGreaterThanOrEqual(
      TABLE_DOC.lastIndexOf('| 1 | 2 |') + '| 1 | 2 |'.length
    );
  });

  it('emits the table widget regardless of cursor position (always rendered)', () => {
    // Cursor placed *inside* the body row — for tables, this MUST still emit
    // the widget (Obsidian-style: rendered always, raw never).
    const cursorIn = TABLE_DOC.indexOf('1');
    const state = makeState(TABLE_DOC, cursorIn);
    const ranges = asRanges(buildDecorations(state));
    const tableRanges = ranges.filter(
      (r) => r.hasWidget && r.spec.widget instanceof TableWidget
    );
    expect(tableRanges).toHaveLength(1);
  });

  it('does not emit inline marks (strong/em) for content inside table cells', () => {
    // Cells contain `**bold**` / `*it*` — the widget owns rendering, so we
    // must not also emit cm-lp-strong / cm-lp-em decorations that would
    // overlap and corrupt the block-replace range.
    const doc = '| **bold** | *it* |\n| --- | --- |\n| x | y |\n';
    const state = makeState(doc, 0);
    const ranges = asRanges(buildDecorations(state));
    expect(ranges.filter((r) => r.spec.class === 'cm-lp-strong')).toHaveLength(0);
    expect(ranges.filter((r) => r.spec.class === 'cm-lp-em')).toHaveLength(0);
    const tableRanges = ranges.filter(
      (r) => r.hasWidget && r.spec.widget instanceof TableWidget
    );
    expect(tableRanges).toHaveLength(1);
  });

  it('coexists with other constructs above/below the table', () => {
    const doc = '# Heading\n\n' + TABLE_DOC + '\n**after**\n';
    const state = makeState(doc, doc.length - 2);
    const ranges = asRanges(buildDecorations(state));
    // Heading line decoration present.
    expect(classAt(ranges, 0, 0)).toBe('cm-lp-h1-line');
    // TableWidget present.
    expect(
      ranges.filter((r) => r.hasWidget && r.spec.widget instanceof TableWidget)
    ).toHaveLength(1);
  });

  it('falls through gracefully if a Table node has no header (defensive)', () => {
    // Hard to construct — @lezer/markdown only emits Table with a delimiter
    // line. The fall-through path in buildDecorations is a guard for
    // mid-edit malformed states. We just verify the test setup itself
    // produces no widget for a non-table row.
    const state = makeState('| pipe but no delim |\nplain text\n', 0);
    const ranges = asRanges(buildDecorations(state));
    expect(
      ranges.filter((r) => r.hasWidget && r.spec.widget instanceof TableWidget)
    ).toHaveLength(0);
  });
});

describe('buildDecorations — inline images', () => {
  const LABELS = { load: 'Load image', base64Blocked: 'Embedded images blocked' };
  const CODE_LABELS = { copy: 'Copy code', copied: 'Copied' };
  const OPTS_ASK = { imageLoadMode: 'ask' as const, imageLabels: LABELS, codeLabels: CODE_LABELS };
  const OPTS_ALWAYS = {
    imageLoadMode: 'always' as const,
    imageLabels: LABELS,
    codeLabels: CODE_LABELS
  };
  const OPTS_NEVER = {
    imageLoadMode: 'never' as const,
    imageLabels: LABELS,
    codeLabels: CODE_LABELS
  };

  it('replaces an image with an ImageWidget when cursor is outside', () => {
    const doc = 'before ![alt](https://example.com/img.png) after';
    const cursor = doc.indexOf('after');
    const state = makeState(doc, cursor);
    const ranges = asRanges(buildDecorations(state, OPTS_ASK));

    const widgets = ranges.filter(
      (r) => r.hasWidget && r.spec.widget instanceof ImageWidget
    );
    expect(widgets).toHaveLength(1);
    const widget = widgets[0].spec.widget as ImageWidget;
    expect(widget.href).toBe('https://example.com/img.png');
    expect(widget.alt).toBe('alt');
    expect(widget.title).toBe('');
    expect(widget.loadMode).toBe('ask');
  });

  it('keeps raw markdown (no widget) when cursor is inside the image range', () => {
    const doc = 'before ![alt](https://example.com/img.png) after';
    const cursor = doc.indexOf('alt');
    const state = makeState(doc, cursor);
    const ranges = asRanges(buildDecorations(state, OPTS_ASK));
    expect(
      ranges.filter((r) => r.hasWidget && r.spec.widget instanceof ImageWidget)
    ).toHaveLength(0);
  });

  it('threads imageLoadMode through to the widget', () => {
    const doc = '![a](https://example.com/x.png)\n\nbody';
    const cursor = doc.length - 1;
    const state = makeState(doc, cursor);

    for (const [opts, expected] of [
      [OPTS_ALWAYS, 'always'],
      [OPTS_NEVER, 'never'],
      [OPTS_ASK, 'ask']
    ] as const) {
      const ranges = asRanges(buildDecorations(state, opts));
      const widget = ranges.find(
        (r) => r.hasWidget && r.spec.widget instanceof ImageWidget
      )?.spec.widget as ImageWidget | undefined;
      expect(widget?.loadMode).toBe(expected);
    }
  });

  it('extracts the optional title from `![alt](url "title")`', () => {
    const doc = '![a](https://example.com/x.png "hover text")\n\nbody';
    const cursor = doc.length - 1;
    const state = makeState(doc, cursor);
    const ranges = asRanges(buildDecorations(state, OPTS_ASK));
    const widget = ranges.find(
      (r) => r.hasWidget && r.spec.widget instanceof ImageWidget
    )?.spec.widget as ImageWidget | undefined;
    expect(widget?.title).toBe('hover text');
  });

  it('passes through data: URIs (widget itself decides how to render)', () => {
    // The widget renders a blocked-warning placeholder for data: URIs, but
    // buildDecorations must still emit a widget so the raw markdown stays
    // hidden (consistent with all other image branches).
    const doc = '![a](data:image/png;base64,abc)\n\nbody';
    const cursor = doc.length - 1;
    const state = makeState(doc, cursor);
    const ranges = asRanges(buildDecorations(state, OPTS_ASK));
    const widget = ranges.find(
      (r) => r.hasWidget && r.spec.widget instanceof ImageWidget
    )?.spec.widget as ImageWidget | undefined;
    expect(widget?.href).toBe('data:image/png;base64,abc');
  });

  it('falls back to raw markdown when the image is nested inside a link', () => {
    // `[![alt](img)](url)` — Lezer parses this as Link > Image. We don't
    // want overlapping LinkWidget + ImageWidget on the same range, so the
    // image case bails out and the link widget takes over.
    const doc = '[![alt](https://example.com/x.png)](https://example.com/page)\n\nbody';
    const cursor = doc.length - 1;
    const state = makeState(doc, cursor);
    const ranges = asRanges(buildDecorations(state, OPTS_ASK));
    expect(
      ranges.filter((r) => r.hasWidget && r.spec.widget instanceof ImageWidget)
    ).toHaveLength(0);
  });

  it('uses fallback options when none are provided', () => {
    // Backwards-compat path: callers (tests, future call sites) that don't
    // pass options still get a working ImageWidget with sensible defaults.
    const doc = '![a](https://example.com/x.png)\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));
    const widget = ranges.find(
      (r) => r.hasWidget && r.spec.widget instanceof ImageWidget
    )?.spec.widget as ImageWidget | undefined;
    expect(widget?.loadMode).toBe('ask');
  });
});

describe('buildDecorations — GFM task list', () => {
  it('applies cm-lp-task-line + cm-lp-task-d1 to a top-level task', () => {
    const doc = '- [ ] one\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));
    const cls = classAt(ranges, 0, 0);
    expect(cls).toContain('cm-lp-task-line');
    expect(cls).toContain('cm-lp-task-d1');
    expect(cls).not.toContain('cm-lp-bullet-line');
  });

  it('adds cm-lp-task-checked when the marker is [x]', () => {
    const doc = '- [x] done\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));
    expect(classAt(ranges, 0, 0)).toContain('cm-lp-task-checked');
  });

  it('also accepts uppercase [X] as checked', () => {
    const doc = '- [X] done\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));
    expect(classAt(ranges, 0, 0)).toContain('cm-lp-task-checked');
  });

  it('replaces "- [ ] " with a TaskCheckboxWidget when cursor is off the line', () => {
    const doc = '- [ ] one\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));
    const widgetRange = ranges.find(
      (r) => r.hasWidget && r.spec.widget instanceof TaskCheckboxWidget
    );
    expect(widgetRange).toBeDefined();
    // "- [ ] " — listMark "-" (1) + " " (1) + TaskMarker "[ ]" (3) + " " (1) = 6
    expect(widgetRange?.from).toBe(0);
    expect(widgetRange?.to).toBe(6);
    expect((widgetRange?.spec.widget as TaskCheckboxWidget).checked).toBe(false);
  });

  it('emits a checked TaskCheckboxWidget for "- [x] "', () => {
    const doc = '- [x] done\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));
    const widget = ranges.find(
      (r) => r.hasWidget && r.spec.widget instanceof TaskCheckboxWidget
    )?.spec.widget as TaskCheckboxWidget | undefined;
    expect(widget?.checked).toBe(true);
  });

  it('shows raw "- [ ] " (no widget) when cursor is on the task line', () => {
    const doc = '- [ ] one\n\nbody';
    const state = makeState(doc, 5); // cursor inside the task line
    const ranges = asRanges(buildDecorations(state));
    const widget = ranges.find(
      (r) => r.hasWidget && r.spec.widget instanceof TaskCheckboxWidget
    );
    expect(widget).toBeUndefined();
  });

  it('does NOT emit cm-lp-bullet-line on a task line (no double styling)', () => {
    const doc = '- [ ] one\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));
    const cls = classAt(ranges, 0, 0) ?? '';
    expect(cls).not.toContain('cm-lp-bullet-d1');
  });

  it('applies cm-lp-task-d2 to nested tasks and hides leading whitespace', () => {
    const doc = '- [ ] outer\n  - [ ] inner\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const ranges = asRanges(buildDecorations(state));

    const nestedLineFrom = doc.indexOf('  - [ ] inner');
    expect(classAt(ranges, nestedLineFrom, nestedLineFrom)).toContain('cm-lp-task-d2');

    const listMarkPos = doc.indexOf('- [ ] inner');
    expect(hasHiddenRange(ranges, nestedLineFrom, listMarkPos)).toBe(true);
  });
});

describe('resolveListClickForward — padding-zone vs content gate', () => {
  // The handler `livePreviewListClickForward` exists to bump clicks landing
  // *before* the rendered content (in the hidden marker / leading whitespace /
  // ::before bullet zone) to the first content character. The pure helper
  // tested here decides yes/no. Two regression families:
  //
  //   - Click on actual content text → MUST return null. Plain (unstyled) list
  //     content has no wrapping span, so its DOM clicks bubble up to `.cm-line`
  //     and the handler used to slam every such click to `contentStart`, even
  //     though the user clicked far past the marker.
  //   - Click in padding/marker zone → MUST return { contentStart } so the
  //     original #146/#153 fix (no caret stuck before a hidden `- `) keeps
  //     working.

  it('returns null for a click on plain content text in a bullet item', () => {
    const doc = '- hello world\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const clickInContent = doc.indexOf('world'); // somewhere past the `- `
    expect(resolveListClickForward(state, clickInContent)).toBeNull();
  });

  it('returns { contentStart } for a click at the start of the line (padding/hidden marker)', () => {
    const doc = '- hello world\n\nbody';
    const state = makeState(doc, doc.length - 1);
    // pos = 0 → before/inside the hidden `- ` marker
    const result = resolveListClickForward(state, 0);
    expect(result).not.toBeNull();
    // Content starts after `- ` → position 2
    expect(result?.contentStart).toBe(2);
  });

  it('returns { contentStart } for a click inside the hidden marker range', () => {
    const doc = '- hello world\n\nbody';
    const state = makeState(doc, doc.length - 1);
    // pos = 1 → between `-` and the space (still in the hidden marker zone)
    const result = resolveListClickForward(state, 1);
    expect(result?.contentStart).toBe(2);
  });

  it('returns null at the exact contentStart boundary (click on first content char)', () => {
    const doc = '- hello world\n\nbody';
    const state = makeState(doc, doc.length - 1);
    // pos = 2 → exactly at `h` of `hello`; CM6 default placement is correct
    expect(resolveListClickForward(state, 2)).toBeNull();
  });

  it('returns null for a click on plain content text in an ordered item', () => {
    const doc = '1. ordered content\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const clickInContent = doc.indexOf('content');
    expect(resolveListClickForward(state, clickInContent)).toBeNull();
  });

  it('returns { contentStart } for a click at the start of an ordered item', () => {
    const doc = '1. ordered content\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const result = resolveListClickForward(state, 0);
    // `1. ` is 3 chars long
    expect(result?.contentStart).toBe(3);
  });

  it('returns null for a click on content of a task item (past the `- [ ] `)', () => {
    const doc = '- [ ] buy milk\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const clickInContent = doc.indexOf('milk');
    expect(resolveListClickForward(state, clickInContent)).toBeNull();
  });

  it('returns { contentStart } past the task marker for a click at start of a task item', () => {
    const doc = '- [ ] buy milk\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const result = resolveListClickForward(state, 0);
    // `- [ ] ` is 6 chars long → content starts at 6
    expect(result?.contentStart).toBe(6);
  });

  it('returns { contentStart } for a click inside the raw `[ ]` of a task item', () => {
    // When the cursor is on the line, raw `- [ ] ` is visible. Clicking inside
    // the `[ ]` should still bump to contentStart (consistent with original
    // handler behavior — avoids landing between `- ` and `[` which collides
    // with the checkbox widget replace range).
    const doc = '- [ ] buy milk\n\nbody';
    const state = makeState(doc, 8); // cursor on the line, raw marker visible
    const clickInsideMarker = 3; // pos of the space inside `[ ]`
    const result = resolveListClickForward(state, clickInsideMarker);
    expect(result?.contentStart).toBe(6);
  });

  it('returns null for a click outside any list (paragraph text)', () => {
    const doc = 'just a paragraph\n\nbody';
    const state = makeState(doc, doc.length - 1);
    expect(resolveListClickForward(state, 5)).toBeNull();
  });

  it('returns null for a click on content of a nested bullet item', () => {
    // Nested list — depth 2 bullet. Clicking on the content text inside the
    // nested item must NOT be forwarded; the bug was that nested clicks were
    // also being slammed to contentStart.
    const doc = '- outer\n  - inner content\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const clickInContent = doc.indexOf('content');
    expect(resolveListClickForward(state, clickInContent)).toBeNull();
  });

  it('returns { contentStart } past the inner marker for a click on the inner ListMark', () => {
    // Nested items: the leading whitespace of the inner item belongs to the
    // OUTER ListItem in the lezer-markdown tree (it's part of the outer
    // item's indented continuation). The inner ListItem range starts at the
    // inner ListMark — so the syntax-tree-driven helper can only recognize
    // "padding click on the inner item" when pos lands on the inner marker
    // itself. Anything left of that resolves to the outer item.
    const doc = '- outer\n  - inner content\n\nbody';
    const state = makeState(doc, doc.length - 1);
    const innerMarkerPos = doc.indexOf('- inner'); // 10 (the `-`)
    const result = resolveListClickForward(state, innerMarkerPos);
    expect(result).not.toBeNull();
    // contentStart = innerMarkerPos + 2 (past `- `)
    expect(result?.contentStart).toBe(innerMarkerPos + 2);
  });
});
