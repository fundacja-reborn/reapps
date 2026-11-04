import { describe, it, expect } from 'vitest';
import { Marked } from 'marked';
import { applyBlockDirection, createMarkdownListRenderers } from './markdown-to-html';

/**
 * RTL content in the Markdown preview: every text block resolves its own
 * direction (`dir="auto"`), independent of the UI locale, so an Arabic
 * paragraph in an English UI renders right-to-left and vice versa.
 */
function render(md: string): string {
  const marked = new Marked({ gfm: true, breaks: true });
  const { renderer, reset } = createMarkdownListRenderers();
  marked.use({ renderer });
  reset();
  return applyBlockDirection(marked.parse(md) as string);
}

describe('applyBlockDirection', () => {
  it('marks paragraphs, headings, lists, quotes and tables dir="auto"', () => {
    const html = render(
      [
        '# مرحبا',
        '',
        'Paragraph',
        '',
        '- one',
        '',
        '1. first',
        '',
        '> quote',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |'
      ].join('\n')
    );
    expect(html).toMatch(/<h1 dir="auto"/);
    expect(html).toMatch(/<p dir="auto">Paragraph/);
    expect(html).toMatch(/<ul dir="auto"/);
    expect(html).toMatch(/<ol dir="auto"/);
    expect(html).toMatch(/<blockquote dir="auto">/);
    expect(html).toMatch(/<table dir="auto">/);
  });

  it('keeps the list renderer depth attribute next to dir', () => {
    expect(render('- a\n  - b')).toMatch(/<ul dir="auto" data-d="2"/);
  });

  it('respects an explicit dir in the note HTML', () => {
    const out = applyBlockDirection('<p dir="rtl">x</p><p>y</p>');
    expect(out).toBe('<p dir="rtl">x</p><p dir="auto">y</p>');
  });

  it('does not touch look-alike tags (pre, path, hr, thead)', () => {
    const input = '<pre><code>x</code></pre><svg><path d="M0"/></svg><hr><thead></thead>';
    expect(applyBlockDirection(input)).toBe(input);
  });
});
