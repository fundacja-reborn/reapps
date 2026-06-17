import { describe, it, expect } from 'vitest';
import { Marked } from 'marked';
import { createMarkdownImageRenderer } from './markdown-to-html';
import type { ImageLoadMode } from '@reborn/storage';

/**
 * Render `content` through a fresh Marked instance wired with the image
 * renderer, exactly as MarkdownPreview does, and report both the HTML and the
 * ask-mode placeholder count that gates the "Load all images" banner. Going
 * through real marked (not a direct renderImage() call) is the point: the
 * regression is that marked must NOT invoke the renderer for image syntax
 * inside code spans / fenced blocks. `translate` is the identity on the key so
 * assertions can match on the key without pulling in i18n.
 */
function render(content: string, mode: ImageLoadMode) {
  const { renderImage, setMode, reset, getAskPlaceholderCount } =
    createMarkdownImageRenderer((key) => key);
  const md = new Marked({ gfm: true, breaks: true });
  md.use({ renderer: { image: renderImage } });
  setMode(mode);
  reset();
  const html = md.parse(content) as string;
  return { html, count: getAskPlaceholderCount() };
}

describe('createMarkdownImageRenderer — "Load all images" banner gating', () => {
  it('counts a real external image in ask mode', () => {
    const { html, count } = render('![alt](https://picsum.photos/200)', 'ask');
    expect(count).toBe(1);
    expect(html).toContain('image-placeholder-load');
  });

  it('counts each of several real images', () => {
    const { count } = render(
      '![a](https://a.test/1.png)\n\n![b](https://b.test/2.png)',
      'ask'
    );
    expect(count).toBe(2);
  });

  it('does NOT count image syntax inside an inline code span', () => {
    // A note documenting image markdown as code — the original false positive.
    const { count } = render('see `![](https://attacker.com/track)` inline', 'ask');
    expect(count).toBe(0);
  });

  it('does NOT count image syntax inside a fenced code block', () => {
    const { count } = render('```md\n![](https://example.com/x.png)\n```', 'ask');
    expect(count).toBe(0);
  });

  it('does NOT count a note that merely mentions the placeholder class name', () => {
    // The exact false positive the previous HTML-substring gate suffered from:
    // the rendered <code> contains the literal "image-placeholder-load" string,
    // yet no real placeholder was emitted. A counter driven by the renderer is
    // immune; a `html.includes('image-placeholder-load')` check is not.
    const { html, count } = render(
      "the gate read `html.includes('image-placeholder-load')`",
      'ask'
    );
    expect(html).toContain('image-placeholder-load'); // present as escaped code text…
    expect(count).toBe(0); // …but no real placeholder beneath it
  });

  it('always mode emits a plain <img> and counts nothing', () => {
    const { html, count } = render('![](https://x.test/y.png)', 'always');
    expect(html).toContain('<img');
    expect(html).not.toContain('image-placeholder-load');
    expect(count).toBe(0);
  });

  it('never mode emits a placeholder without a Load button and counts nothing', () => {
    const { html, count } = render('![](https://x.test/y.png)', 'never');
    expect(html).toContain('image-placeholder');
    expect(html).not.toContain('image-placeholder-load');
    expect(count).toBe(0);
  });

  it('blocks data: URIs and counts nothing', () => {
    const { html, count } = render('![](data:image/png;base64,AAAA)', 'ask');
    expect(html).toContain('image-placeholder--blocked');
    expect(count).toBe(0);
  });

  it('reset() zeroes the counter between parses', () => {
    const { renderImage, setMode, reset, getAskPlaceholderCount } =
      createMarkdownImageRenderer((key) => key);
    const md = new Marked({ gfm: true, breaks: true });
    md.use({ renderer: { image: renderImage } });
    setMode('ask');

    reset();
    md.parse('![](https://a.test/1.png)');
    expect(getAskPlaceholderCount()).toBe(1);

    reset();
    md.parse('no images here');
    expect(getAskPlaceholderCount()).toBe(0);
  });
});
