import { describe, expect, it } from 'vitest';
import { Marked, type Token, type Tokens } from 'marked';
import {
  blankLinesHtml,
  extraBlankLines,
  markExtraBlankLines,
  type BlankLineListItem
} from './blank-lines';
import { createMarkdownListRenderers } from './markdown-to-html';

function render(source: string, preserve = true): string {
  const md = new Marked({ gfm: true, breaks: true });
  md.use({ renderer: createMarkdownListRenderers().renderer });
  const tokens = md.lexer(source);
  if (preserve) markExtraBlankLines(tokens);
  return md.parser(tokens) as string;
}

/** Sizes of the rendered spacers, in document order. */
function spacers(html: string): number[] {
  return [...html.matchAll(/<div class="md-blank-lines" aria-hidden="true">((?:<br>)+)<\/div>/g)].map(
    (m) => m[1].length / '<br>'.length
  );
}

function stamps(tokens: Token[]): number[] {
  return tokens.filter((t) => t.type === 'space').map((t) => extraBlankLines(t));
}

describe('blankLinesHtml', () => {
  it('renders one <br> per line and nothing for zero', () => {
    expect(blankLinesHtml(0)).toBe('');
    expect(blankLinesHtml(-1)).toBe('');
    expect(blankLinesHtml(2)).toBe('<div class="md-blank-lines" aria-hidden="true"><br><br></div>\n');
  });
});

describe('markExtraBlankLines - between blocks', () => {
  it('leaves a single blank line alone (the normal block break)', () => {
    expect(spacers(render('a\n\nb'))).toEqual([]);
  });

  it('keeps every blank line beyond the first', () => {
    expect(spacers(render('a\n\n\nb'))).toEqual([1]);
    expect(spacers(render('a\n\n\n\nb'))).toEqual([2]);
  });

  it('counts lines holding only spaces or tabs as blank', () => {
    expect(spacers(render('a\n  \n\t\n\nb'))).toEqual([2]);
  });

  it('works after any kind of block, not only paragraphs', () => {
    const before = ['# h', '---', '```\nx\n```', '|a|b|\n|-|-|\n|1|2|', '<div>x</div>', '> q', '- item'];
    for (const block of before) {
      // `---` right after a paragraph would be a Setext heading, so it leads.
      expect(spacers(render(`${block}\n\n\n\nb`)), block).toEqual([2]);
    }
  });

  it('places the spacer between the two blocks', () => {
    expect(render('a\n\n\n\nb')).toBe(
      '<p>a</p>\n<div class="md-blank-lines" aria-hidden="true"><br><br></div>\n<p>b</p>\n'
    );
  });

  it('ignores blank lines at the start and at the end of the note', () => {
    expect(spacers(render('\n\n\na\n\n\n\n'))).toEqual([]);
  });

  it('leaves the gaps around a link reference definition alone', () => {
    expect(spacers(render('a\n\n\n\n[x]: https://example.com\n\n\n\nb'))).toEqual([]);
  });

  it('leaves blank lines inside a code block to the code block', () => {
    const html = render('```\nx\n\n\n\ny\n```');
    expect(spacers(html)).toEqual([]);
    expect(html).toContain('x\n\n\n\ny');
  });

  it('renders nothing extra when the tokens were not stamped (setting off)', () => {
    expect(render('a\n\n\n\nb', false)).toBe('<p>a</p>\n<p>b</p>\n');
    expect(spacers(render('- a\n\n\n\n- b', false))).toEqual([]);
  });

  it('stamps the space token, so the preview can pair it with its spacer', () => {
    const tokens = new Marked({ gfm: true }).lexer('a\n\nb\n\n\n\nc');
    markExtraBlankLines(tokens);
    expect(stamps(tokens)).toEqual([0, 2]);
  });
});

describe('markExtraBlankLines - the example from issue #549', () => {
  it('sets a list and the paragraphs after it apart', () => {
    const html = render('- one.\n\n- two.\n\n\n\nA- three.\n\nB- four.');
    expect(spacers(html)).toEqual([2]);
    expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('md-blank-lines'));
    expect(html.indexOf('md-blank-lines')).toBeLessThan(html.indexOf('A- three.'));
  });
});

describe('markExtraBlankLines - lists', () => {
  it('keeps blank lines between two items inside the same list', () => {
    const html = render('- a\n- b\n\n\n\n- c\n- d');
    expect(spacers(html)).toEqual([2]);
    expect(html.match(/<ul/g)).toHaveLength(1);
    // At the end of the item before the gap.
    expect(html).toMatch(/<li><p>b<\/p>\n<div class="md-blank-lines" aria-hidden="true"><br><br><\/div>\n<\/li>/);
  });

  it('does not add a spacer for the usual single blank line of a loose list', () => {
    expect(spacers(render('- a\n\n- b\n\n- c'))).toEqual([]);
  });

  it('keeps an ordered list counting across the gap', () => {
    const html = render('1. a\n\n\n\n2. b');
    expect(spacers(html)).toEqual([2]);
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it('puts the spacer after a nested list, at the end of the outer item', () => {
    const html = render('- a\n  - b\n\n\n\n- c');
    expect(spacers(html)).toEqual([2]);
    expect(html.indexOf('>b<')).toBeLessThan(html.indexOf('md-blank-lines'));
    expect(html.indexOf('md-blank-lines')).toBeLessThan(html.indexOf('>c<'));
  });

  it('keeps blank lines between two blocks of one item', () => {
    expect(spacers(render('- a\n\n\n\n  cont\n- z'))).toEqual([2]);
  });

  it('works for task items without touching their index', () => {
    const html = render('- [ ] a\n\n\n\n- [x] b');
    expect(spacers(html)).toEqual([2]);
    expect(html).toContain('data-task-index="0"');
    expect(html).toContain('data-task-index="1"');
    // After the content wrapper, still inside the first item.
    expect(html).toMatch(/<\/span><div class="md-blank-lines" aria-hidden="true"><br><br><\/div>\n<\/li>/);
  });

  it('stamps the item, never the last one of a list', () => {
    const tokens = new Marked({ gfm: true }).lexer('- a\n\n\n\n- b\n\n\n\nc');
    markExtraBlankLines(tokens);
    const items = (tokens[0] as Tokens.List).items as BlankLineListItem[];
    expect(items.map((i) => i._blankLinesAfter ?? 0)).toEqual([2, 0]);
    // The blank lines after the list are the gap that follows the list.
    expect(stamps(tokens)).toEqual([2]);
  });
});

describe('markExtraBlankLines - block quotes', () => {
  it('keeps blank lines inside a quote and after it', () => {
    const html = render('> a\n>\n>\n>\n> b\n\n\n\nc');
    expect(spacers(html)).toEqual([2, 2]);
    const quoteEnd = html.indexOf('</blockquote>');
    expect(html.indexOf('md-blank-lines')).toBeLessThan(quoteEnd);
    expect(html.lastIndexOf('md-blank-lines')).toBeGreaterThan(quoteEnd);
  });
});
