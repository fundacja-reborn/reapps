// @vitest-environment jsdom
/**
 * The Live Preview TOC widget renders the SAME boxed nav + corner toolbar the
 * rendered preview shows, through marked + DOMPurify. These guard the DOM shape
 * the `livePreviewTocActions` click handler and the `.cm-lp-toc` theme depend on.
 */
import { describe, it, expect } from 'vitest';
import { TocWidget } from './toc-widget';
import { applyToc, tocInnerMarkdown } from '$lib/utils/toc';

const labels = { refresh: 'Refresh', stale: 'Out of date', remove: 'Remove' };
const content = applyToc('# Doc\n\n## Bezpieczeństwo\n\n## Section Two\n', { title: 'Contents' })!;
const inner = tocInnerMarkdown(content)!;

describe('TocWidget.toDOM', () => {
  it('renders a boxed <nav> with the refresh + remove toolbar', () => {
    const dom = new TocWidget(inner, false, labels).toDOM();
    expect(dom.tagName).toBe('NAV');
    expect(dom.classList.contains('cm-lp-toc')).toBe(true);
    expect(dom.hasAttribute('data-note-toc')).toBe(true);
    expect(dom.querySelector('.cm-lp-toc-refresh')).not.toBeNull();
    expect(dom.querySelector('.cm-lp-toc-remove')).not.toBeNull();
    expect(dom.querySelector('.cm-lp-toc-actions svg')).not.toBeNull();
  });

  it('links entries to the heading slugs and keeps the title a bold, non-heading', () => {
    const dom = new TocWidget(inner, false, labels).toDOM();
    // marked percent-encodes the href (ń → %C5%84); the click handler decodes it
    // back, so the round-trip must land on the slug extractHeadings stamps.
    const hrefs = [...dom.querySelectorAll('.cm-lp-toc a')].map((a) =>
      decodeURIComponent(a.getAttribute('href') ?? '')
    );
    expect(hrefs).toContain('#bezpieczeństwo');
    expect(hrefs).toContain('#section-two');
    // The TOC title is a <strong>, never a heading — no outline/anchor pollution.
    expect(dom.querySelector('strong')).not.toBeNull();
    expect(dom.querySelector('h1, h2, h3')).toBeNull();
  });

  it('marks the refresh button stale and swaps its label/title', () => {
    const fresh = new TocWidget(inner, false, labels).toDOM();
    expect(fresh.querySelector('.cm-lp-toc-refresh.is-stale')).toBeNull();
    expect(fresh.querySelector('.cm-lp-toc-refresh')?.getAttribute('title')).toBe('Refresh');

    const stale = new TocWidget(inner, true, labels).toDOM();
    expect(stale.querySelector('.cm-lp-toc-refresh.is-stale')).not.toBeNull();
    expect(stale.querySelector('.cm-lp-toc-refresh')?.getAttribute('title')).toBe('Out of date');
  });

  it('eq() tracks inner markdown, stale flag and labels', () => {
    const base = new TocWidget(inner, false, labels);
    expect(base.eq(new TocWidget(inner, false, labels))).toBe(true);
    expect(base.eq(new TocWidget(inner, true, labels))).toBe(false);
    expect(base.eq(new TocWidget(inner + '\n- [Extra](#extra)', false, labels))).toBe(false);
    expect(base.eq(new TocWidget(inner, false, { ...labels, remove: 'Delete' }))).toBe(false);
  });
});
