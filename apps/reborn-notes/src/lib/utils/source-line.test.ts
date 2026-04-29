// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import {
  annotateTopLevelLines,
  applySourceLineAttrs,
  collectPreviewAnchors,
  topLineFor,
  offsetForLine,
  type AnnotatedToken,
  type PreviewAnchor
} from './source-line';

describe('annotateTopLevelLines', () => {
  it('counts blank lines between blocks', () => {
    const src = 'Hello\n\nWorld';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const annotated = tokens as AnnotatedToken[];
    expect(annotated[0]._line).toBe(1); // "Hello"
    // tokens[1] is `space` — its _line is the line where the token starts in
    // source (immediately after "Hello", same line, since marked strips the
    // paragraph's trailing newline). Space tokens render to empty string so
    // their _line is irrelevant for alignment; only paragraphs/headings/etc.
    // matter.
    expect(annotated[1]._line).toBe(1);
    // tokens[2] is the second paragraph at line 3 (after \n\n)
    expect(annotated[2]._line).toBe(3);
  });

  it('handles headings and lists', () => {
    const src = '# Title\n\nIntro paragraph.\n\n- a\n- b\n\n## Section';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const annotated = tokens as AnnotatedToken[];
    const types = annotated.map((t) => `${t.type}@${t._line}`);
    expect(types).toContain('heading@1');
    expect(types).toContain('paragraph@3');
    expect(types).toContain('list@5');
    expect(types).toContain('heading@8');
  });

  it('counts every newline in a multi-line code fence', () => {
    const src = '```\na\nb\nc\n```\n\nafter';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const annotated = tokens as AnnotatedToken[];
    const code = annotated.find((t) => t.type === 'code');
    const after = annotated.find((t) => t.type === 'paragraph');
    expect(code?._line).toBe(1);
    expect(after?._line).toBe(7);
  });

  it('stamps `_endLine` for single-line blocks (= `_line`)', () => {
    const src = '# Title\n\nbody';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const annotated = tokens as AnnotatedToken[];
    const heading = annotated.find((t) => t.type === 'heading');
    const para = annotated.find((t) => t.type === 'paragraph');
    expect(heading?._line).toBe(1);
    expect(heading?._endLine).toBe(1);
    expect(para?._line).toBe(3);
    expect(para?._endLine).toBe(3);
  });

  it('stamps `_endLine` for a multi-line code fence (last line of block)', () => {
    const src = '```\na\nb\nc\n```\n\nafter';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const annotated = tokens as AnnotatedToken[];
    const code = annotated.find((t) => t.type === 'code');
    // 5 source lines: ```, a, b, c, ```
    expect(code?._line).toBe(1);
    expect(code?._endLine).toBe(5);
  });

  it('stamps `_endLine` for a multi-line list', () => {
    const src = '- a\n- b\n- c\n\nafter';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const annotated = tokens as AnnotatedToken[];
    const list = annotated.find((t) => t.type === 'list');
    expect(list?._line).toBe(1);
    expect(list?._endLine).toBe(3);
  });

  it('stamps `_endLine` for a multi-line blockquote', () => {
    const src = '> q1\n> q2\n> q3\n\nafter';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const annotated = tokens as AnnotatedToken[];
    const bq = annotated.find((t) => t.type === 'blockquote');
    expect(bq?._line).toBe(1);
    expect(bq?._endLine).toBe(3);
  });

  it('stamps `_endLine` for a multi-line paragraph (soft-wrapped source)', () => {
    const src = 'line1\nline2\nline3\n\nafter';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const annotated = tokens as AnnotatedToken[];
    expect(annotated[0]._line).toBe(1);
    expect(annotated[0]._endLine).toBe(3);
  });
});

describe('applySourceLineAttrs', () => {
  it('stamps the first child with the first non-space token line', () => {
    const src = 'A\n\nB';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const container = document.createElement('div');
    container.innerHTML = marked.parser(tokens) as string;
    applySourceLineAttrs(container, tokens);
    const ps = container.querySelectorAll('p');
    expect(ps[0].getAttribute('data-source-line')).toBe('1');
    expect(ps[1].getAttribute('data-source-line')).toBe('3');
  });

  it('skips space tokens when pairing', () => {
    const src = '# Title\n\n\n\npara';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const container = document.createElement('div');
    container.innerHTML = marked.parser(tokens) as string;
    applySourceLineAttrs(container, tokens);
    expect(container.querySelector('h1')?.getAttribute('data-source-line')).toBe('1');
    expect(container.querySelector('p')?.getAttribute('data-source-line')).toBe('5');
  });

  it('stamps `data-source-line-end` equal to start for single-line blocks', () => {
    const src = '# Title\n\npara';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const container = document.createElement('div');
    container.innerHTML = marked.parser(tokens) as string;
    applySourceLineAttrs(container, tokens);
    const h1 = container.querySelector('h1')!;
    const p = container.querySelector('p')!;
    expect(h1.getAttribute('data-source-line-end')).toBe('1');
    expect(p.getAttribute('data-source-line-end')).toBe('3');
  });

  it('stamps `data-source-line-end` past `data-source-line` for multi-line blocks', () => {
    const src = '```\na\nb\nc\n```\n\nafter';
    const tokens = marked.lexer(src);
    annotateTopLevelLines(tokens);
    const container = document.createElement('div');
    container.innerHTML = marked.parser(tokens) as string;
    applySourceLineAttrs(container, tokens);
    const pre = container.querySelector('pre')!;
    expect(pre.getAttribute('data-source-line')).toBe('1');
    expect(pre.getAttribute('data-source-line-end')).toBe('5');
  });
});

describe('topLineFor / offsetForLine', () => {
  // Single-line anchors (startLine === endLine, top === bottom would be
  // degenerate in real DOM but works mathematically — the functions clamp).
  const single: PreviewAnchor[] = [
    { startLine: 1, endLine: 1, top: 0, bottom: 20 },
    { startLine: 5, endLine: 5, top: 100, bottom: 120 },
    { startLine: 10, endLine: 10, top: 250, bottom: 270 },
    { startLine: 20, endLine: 20, top: 500, bottom: 520 }
  ];

  it('returns 1 for empty anchors', () => {
    expect(topLineFor([], 100)).toBe(1);
    expect(offsetForLine([], 5)).toBe(0);
  });

  it('clamps to first anchor before its top', () => {
    expect(topLineFor(single, 0)).toBe(1);
    expect(topLineFor(single, -50)).toBe(1);
  });

  it('returns startLine when y == top of an anchor', () => {
    expect(topLineFor(single, 100)).toBe(5);
    expect(topLineFor(single, 250)).toBe(10);
  });

  it('returns endLine when y == bottom of last anchor', () => {
    expect(topLineFor(single, 520)).toBe(20);
    expect(topLineFor(single, 1000)).toBe(20);
  });

  it('interpolates fractionally inside a multi-line anchor', () => {
    // One anchor that owns lines 4..30 spanning y=200..1500.
    // 30 - 4 = 26 lines over 1300 px → 50 px per line.
    const code: PreviewAnchor[] = [
      { startLine: 1, endLine: 1, top: 0, bottom: 50 },
      { startLine: 4, endLine: 30, top: 200, bottom: 1500 },
      { startLine: 32, endLine: 32, top: 1550, bottom: 1600 }
    ];
    // y at 200 → line 4
    expect(topLineFor(code, 200)).toBeCloseTo(4, 6);
    // halfway through the block: y=850 (200 + 650), should be line 4 + 13 = 17
    expect(topLineFor(code, 850)).toBeCloseTo(17, 6);
    // 80% through: line 4 + 0.8*26 = 24.8
    expect(topLineFor(code, 200 + 0.8 * 1300)).toBeCloseTo(24.8, 6);
  });

  it('offsetForLine interpolates inverse of topLineFor', () => {
    const code: PreviewAnchor[] = [
      { startLine: 1, endLine: 1, top: 0, bottom: 50 },
      { startLine: 4, endLine: 30, top: 200, bottom: 1500 },
      { startLine: 32, endLine: 32, top: 1550, bottom: 1600 }
    ];
    expect(offsetForLine(code, 4)).toBeCloseTo(200, 6);
    expect(offsetForLine(code, 17)).toBeCloseTo(850, 6);
    expect(offsetForLine(code, 30)).toBeCloseTo(1500, 6);
    // Fractional input passes through cleanly.
    expect(offsetForLine(code, 12.5)).toBeCloseTo(200 + (12.5 - 4) * 50, 6);
  });

  it('interpolates the gap between two anchors so sync stays continuous', () => {
    // Two single-line anchors with a 100px gap (margin between blocks).
    const anchors: PreviewAnchor[] = [
      { startLine: 1, endLine: 1, top: 0, bottom: 20 },
      { startLine: 3, endLine: 3, top: 120, bottom: 140 }
    ];
    // y in the middle of the gap should yield a value between line 1 and 3.
    const mid = topLineFor(anchors, 70);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(3);
  });

  it('finds offset for line clamped before/after the range', () => {
    expect(offsetForLine(single, 0)).toBe(0);
    expect(offsetForLine(single, 1)).toBe(0);
    // Past the last endLine — clamp to bottom of last anchor.
    expect(offsetForLine(single, 9999)).toBe(520);
  });
});

describe('collectPreviewAnchors', () => {
  it('reads start and end lines from rendered DOM in document order', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = `
      <p data-source-line="1" data-source-line-end="1">a</p>
      <pre data-source-line="3" data-source-line-end="8">b</pre>
      <p data-source-line="10" data-source-line-end="10">c</p>
    `;
    const anchors = collectPreviewAnchors(container);
    expect(anchors.map((a) => [a.startLine, a.endLine])).toEqual([
      [1, 1],
      [3, 8],
      [10, 10]
    ]);
    document.body.removeChild(container);
  });

  it('falls back to startLine when `data-source-line-end` is absent', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = `<p data-source-line="4">x</p>`;
    const anchors = collectPreviewAnchors(container);
    expect(anchors[0].startLine).toBe(4);
    expect(anchors[0].endLine).toBe(4);
    document.body.removeChild(container);
  });
});
