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

  it('marks only the outermost block; nested ones inherit', () => {
    // A dir="auto" container skips descendants with their own dir when it
    // resolves its direction, so an inner dir would leave the quote / list
    // without a strong character (an Arabic quote got its border on the left).
    expect(render('> العلم نور\n>\n> سطر ثان')).toMatch(
      /<blockquote dir="auto">\s*<p>العلم نور<\/p>\s*<p>سطر ثان<\/p>/
    );
    const nested = render('- a\n  - b');
    expect(nested).toMatch(/<ul dir="auto" data-d="1"/);
    expect(nested).toMatch(/<ul data-d="2"/);
    // Loose list: items wrap their text in <p>.
    expect(render('- one\n\n- two')).not.toMatch(/<p dir=/);
    // Siblings after a closed block are outermost again.
    expect(applyBlockDirection('<blockquote><p>a</p></blockquote><p>b</p>')).toBe(
      '<blockquote dir="auto"><p>a</p></blockquote><p dir="auto">b</p>'
    );
  });

  it('respects an explicit dir in the note HTML, including its subtree', () => {
    const out = applyBlockDirection('<p dir="rtl">x</p><div dir="ltr"><p>y</p></div><p>z</p>');
    expect(out).toBe('<p dir="rtl">x</p><div dir="ltr"><p>y</p></div><p dir="auto">z</p>');
  });

  it('is not fooled by tags inside attribute values, void elements or comments', () => {
    expect(applyBlockDirection('<p><img alt="a <p> b">x</p><p>y</p>')).toBe(
      '<p dir="auto"><img alt="a <p> b">x</p><p dir="auto">y</p>'
    );
    expect(applyBlockDirection('<p>a<br>b</p><hr><p>c</p>')).toBe(
      '<p dir="auto">a<br>b</p><hr><p dir="auto">c</p>'
    );
    expect(applyBlockDirection('<!-- <p> --><p>x</p>')).toBe('<!-- <p> --><p dir="auto">x</p>');
  });

  it('leaves code blocks to the code renderer (dir="ltr" wrapper)', () => {
    const html = '<div class="code-block" dir="ltr"><pre><code>x</code></pre></div>';
    expect(applyBlockDirection(html)).toBe(html);
  });

  it('does not touch look-alike tags (pre, path, hr, thead)', () => {
    const input = '<pre><code>x</code></pre><svg><path d="M0"/></svg><hr><thead></thead>';
    expect(applyBlockDirection(input)).toBe(input);
  });
});
