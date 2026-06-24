// @vitest-environment jsdom
/**
 * Integration guard for the owner-editable TOC: the atomic <nav> block produced
 * by toEditableTocBlock must survive MarkdownPreview's marked + DOMPurify
 * pipeline with its toolbar (buttons + svg) and #slug anchors intact, and render
 * as exactly ONE top-level node (so the source-line zip stays aligned). The
 * sanitize config mirrors MarkdownPreview.svelte; keep them in sync.
 */
import { describe, it, expect } from 'vitest';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

import { applyToc, tocInnerMarkdown, toEditableTocBlock } from './toc';

const ALLOWED_URI =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|note):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i; // eslint-disable-line no-useless-escape
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    ALLOWED_URI_REGEXP: ALLOWED_URI
  });
}

const md = new Marked({ gfm: true, breaks: true });
const tocMd = new Marked({ gfm: true, breaks: true });

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v5h5"/></svg>';
const buttons =
  '<span class="note-toc-actions">' +
  `<button type="button" class="note-toc-btn note-toc-refresh is-stale" aria-label="Refresh" title="Refresh">${SVG}</button>` +
  `<button type="button" class="note-toc-btn note-toc-remove" aria-label="Remove" title="Remove">${SVG}</button>` +
  '</span>';

function renderEditable(content: string): string {
  const inner = tocMd.parse(tocInnerMarkdown(content)!) as string;
  const source = toEditableTocBlock(content, inner, buttons);
  return sanitize(md.parser(md.lexer(source)) as string);
}

describe('editable TOC survives marked + DOMPurify', () => {
  const content = applyToc('# Doc\n\n## Bezpieczeństwo\n\n## Section Two\n', { title: 'Contents' })!;

  it('keeps the <nav>, toolbar buttons, svg and #slug anchors', () => {
    const root = document.createElement('div');
    root.innerHTML = renderEditable(content);

    const nav = root.querySelector('nav.note-toc');
    expect(nav).not.toBeNull();
    expect(nav!.hasAttribute('data-note-toc')).toBe(true);
    expect(root.querySelector('.note-toc-refresh.is-stale')).not.toBeNull();
    expect(root.querySelector('.note-toc-remove')).not.toBeNull();
    expect(root.querySelector('nav.note-toc svg')).not.toBeNull();

    // marked percent-encodes the href (ń -> %C5%84); MarkdownPreview's click
    // handler decodeURIComponent()s it back before matching a heading id, so the
    // round-trip must land on the same slug extractHeadings stamps.
    const hrefs = [...root.querySelectorAll('nav.note-toc a')].map((a) =>
      decodeURIComponent(a.getAttribute('href') ?? '')
    );
    expect(hrefs).toContain('#bezpieczeństwo');
    expect(hrefs).toContain('#section-two');
  });

  it('renders the TOC as a single top-level node, headings as separate siblings', () => {
    const root = document.createElement('div');
    root.innerHTML = renderEditable(content);

    // One nav, and the note's real headings stay OUTSIDE it as their own nodes -
    // this 1 token / 1 node shape is what keeps applySourceLineAttrs aligned.
    expect(root.querySelectorAll('nav.note-toc').length).toBe(1);
    expect(root.querySelectorAll(':scope > h2').length).toBe(2);
    expect(root.querySelector('nav.note-toc h2')).toBeNull();
    // The bold TOC title is a <strong>, never a heading (no outline/anchor pollution).
    expect(root.querySelector('nav.note-toc strong')).not.toBeNull();
  });
});
