import { describe, it, expect } from 'vitest';
import { parseInlineCell, cellHasFormatting, type InlineNode } from './table-cell-render';

/** Collapse an AST to a compact string so assertions read clearly. */
function sketch(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return n.value;
        case 'br':
          return '<br>';
        case 'code':
          return `code(${n.value})`;
        case 'strong':
          return `strong(${sketch(n.children)})`;
        case 'em':
          return `em(${sketch(n.children)})`;
        case 'strike':
          return `strike(${sketch(n.children)})`;
        case 'link':
          return `link(${n.text}|${n.url})`;
      }
    })
    .join('');
}

describe('parseInlineCell — basic constructs', () => {
  it('parses **bold**', () => {
    expect(sketch(parseInlineCell('**bold**'))).toBe('strong(bold)');
  });

  it('parses __bold__', () => {
    expect(sketch(parseInlineCell('__bold__'))).toBe('strong(bold)');
  });

  it('parses *italic*', () => {
    expect(sketch(parseInlineCell('*italic*'))).toBe('em(italic)');
  });

  it('parses _italic_', () => {
    expect(sketch(parseInlineCell('_italic_'))).toBe('em(italic)');
  });

  it('parses ~~strike~~', () => {
    expect(sketch(parseInlineCell('~~gone~~'))).toBe('strike(gone)');
  });

  it('parses `code`', () => {
    expect(sketch(parseInlineCell('`code`'))).toBe('code(code)');
  });

  it('does not parse markdown inside code spans', () => {
    expect(sketch(parseInlineCell('`a *b* c`'))).toBe('code(a *b* c)');
  });

  it('strips one padding space inside a code span', () => {
    expect(sketch(parseInlineCell('` x `'))).toBe('code(x)');
  });
});

describe('parseInlineCell — links', () => {
  it('parses [text](url)', () => {
    expect(sketch(parseInlineCell('[home](https://x.dev)'))).toBe('link(home|https://x.dev)');
  });

  it('drops a link title', () => {
    expect(sketch(parseInlineCell('[t](https://x.dev "title")'))).toBe('link(t|https://x.dev)');
  });

  it('keeps note links intact', () => {
    const url = 'note:11111111-2222-3333-4444-555555555555';
    expect(sketch(parseInlineCell(`[ref](${url})`))).toBe(`link(ref|${url})`);
  });

  it('leaves bracket text without a destination literal', () => {
    expect(sketch(parseInlineCell('[not a link]'))).toBe('[not a link]');
  });
});

describe('parseInlineCell — mixed & nested', () => {
  it('mixes formatting with surrounding text', () => {
    expect(sketch(parseInlineCell('a **b** c `d`'))).toBe('a strong(b) c code(d)');
  });

  it('nests emphasis inside strong', () => {
    expect(sketch(parseInlineCell('**a _b_ c**'))).toBe('strong(a em(b) c)');
  });

  it('allows intraword asterisk emphasis', () => {
    expect(sketch(parseInlineCell('a*b*c'))).toBe('aem(b)c');
  });
});

describe('parseInlineCell — guards against false positives', () => {
  it('keeps snake_case literal', () => {
    expect(sketch(parseInlineCell('snake_case'))).toBe('snake_case');
  });

  it('keeps intraword underscores literal', () => {
    expect(sketch(parseInlineCell('a_b_c'))).toBe('a_b_c');
  });

  it('keeps an unmatched delimiter literal', () => {
    expect(sketch(parseInlineCell('**bold'))).toBe('**bold');
  });

  it('does not open emphasis on a space', () => {
    expect(sketch(parseInlineCell('a * b * c'))).toBe('a * b * c');
  });

  it('treats an empty delimiter run as literal', () => {
    expect(sketch(parseInlineCell('****'))).toBe('****');
  });

  it('does not treat a bare asterisk as emphasis', () => {
    expect(sketch(parseInlineCell('2 * 3 = 6'))).toBe('2 * 3 = 6');
  });
});

describe('parseInlineCell — line breaks', () => {
  it('splits lines into br nodes', () => {
    expect(sketch(parseInlineCell('a\nb'))).toBe('a<br>b');
  });

  it('keeps formatting per line', () => {
    expect(sketch(parseInlineCell('**a**\n*b*'))).toBe('strong(a)<br>em(b)');
  });

  it('handles an empty cell', () => {
    expect(parseInlineCell('')).toEqual([]);
  });
});

describe('cellHasFormatting', () => {
  it.each(['**bold**', '_em_', '`code`', '~~s~~', '[t](https://x.dev)', 'a **b**'])(
    'is true for %s',
    (input) => {
      expect(cellHasFormatting(input)).toBe(true);
    }
  );

  it.each(['plain text', 'snake_case', 'a_b_c', '2 * 3', 'line one\nline two', '', '[not a link]'])(
    'is false for %s',
    (input) => {
      expect(cellHasFormatting(input)).toBe(false);
    }
  );
});
