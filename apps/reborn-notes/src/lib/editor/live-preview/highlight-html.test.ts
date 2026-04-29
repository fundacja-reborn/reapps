import { describe, it, expect } from 'vitest';
import { escapeHtml, highlightCodeToHtml } from './highlight-html';

describe('escapeHtml', () => {
  it.each([
    ['plain text', 'plain text'],
    ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['"quoted" & ampersand', '&quot;quoted&quot; &amp; ampersand'],
    ["it's", 'it&#39;s'],
    ['a < b > c', 'a &lt; b &gt; c'],
    ['', '']
  ])('escapes %j → %j', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });
});

describe('highlightCodeToHtml', () => {
  it('wraps output in <pre class="cm-lp-codeblock"><code>', () => {
    const html = highlightCodeToHtml('hello', '');
    expect(html.startsWith('<pre class="cm-lp-codeblock"><code')).toBe(true);
    expect(html.endsWith('</code></pre>')).toBe(true);
  });

  it('adds lang-X class when info string is sane', () => {
    expect(highlightCodeToHtml('x', 'js')).toContain('class="lang-js"');
    expect(highlightCodeToHtml('x', 'JS')).toContain('class="lang-js"'); // lowercased
    expect(highlightCodeToHtml('x', 'rust-2024')).toContain('class="lang-rust-2024"');
  });

  it('omits the class for an empty / unsafe info string', () => {
    expect(highlightCodeToHtml('x', '')).not.toContain('class="lang-');
    expect(highlightCodeToHtml('x', '<script>')).not.toContain('class="lang-');
    expect(highlightCodeToHtml('x', 'has space')).not.toContain('class="lang-');
  });

  it('escapes HTML special chars in code body', () => {
    const html = highlightCodeToHtml('<script>alert(1)</script>', '');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)');
  });

  it('escapes HTML special chars in code body even with a known language', () => {
    // Without a loaded language, the helper still escapes — text is the only
    // thing inside <code> until the lang chunk arrives.
    const html = highlightCodeToHtml('a < b && c > d', 'js');
    expect(html).toContain('a &lt; b &amp;&amp; c &gt; d');
  });

  it('renders unloaded languages as plaintext (no spans)', () => {
    // No language chunk is loaded in test env — `getLoadedLanguage` returns null,
    // so the body is the raw escaped string with no `<span class="tok-…">` markup.
    const html = highlightCodeToHtml('const x = 1;', 'js');
    expect(html).not.toContain('<span class="tok-');
  });

  it('never inserts user-supplied HTML attributes via the info string', () => {
    // 32-char limit + regex stripping prevents any kind of attribute injection.
    const html = highlightCodeToHtml('x', 'js" onclick="alert(1)');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('alert');
  });
});
