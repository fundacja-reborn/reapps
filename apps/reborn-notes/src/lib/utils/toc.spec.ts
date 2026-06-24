import { describe, it, expect } from 'vitest';

import {
  buildTocBlock,
  applyToc,
  removeToc,
  hasToc,
  isTocStale,
  tocInnerMarkdown,
  toEditableTocBlock,
  TOC_OPEN,
  TOC_CLOSE
} from './toc';
import { extractHeadings } from './heading-outline';

const opts = { title: 'Contents' };

describe('buildTocBlock', () => {
  it('lists headings, indenting relative to the shallowest depth', () => {
    const block = buildTocBlock(
      [
        { depth: 1, text: 'A', slug: 'a', line: 1 },
        { depth: 2, text: 'B', slug: 'b', line: 2 },
        { depth: 3, text: 'C', slug: 'c', line: 3 }
      ],
      opts
    );
    expect(block).toBe(
      `${TOC_OPEN}\n\n**Contents**\n\n- [A](#a)\n  - [B](#b)\n    - [C](#c)\n\n${TOC_CLOSE}`
    );
  });

  it('flushes left when headings start below H1 (base = shallowest present)', () => {
    const block = buildTocBlock(
      [
        { depth: 2, text: 'B', slug: 'b', line: 1 },
        { depth: 3, text: 'C', slug: 'c', line: 2 }
      ],
      opts
    );
    expect(block).toContain('\n- [B](#b)\n  - [C](#c)\n');
  });

  it('escapes Markdown link-label metacharacters in the heading text', () => {
    const block = buildTocBlock([{ depth: 1, text: 'a[b]c', slug: 'abc', line: 1 }], opts);
    expect(block).toContain('- [a\\[b\\]c](#abc)');
  });

  it('returns null when no heading falls in the depth window', () => {
    expect(buildTocBlock([], opts)).toBeNull();
    expect(
      buildTocBlock([{ depth: 1, text: 'x', slug: 'x', line: 1 }], { ...opts, min: 2, max: 3 })
    ).toBeNull();
  });
});

describe('applyToc - first insertion', () => {
  it('pins the block just after the first H1', () => {
    const doc = '# Doc\n\nlead\n\n## S1\n\n## S2\n';
    const out = applyToc(doc, opts)!;
    expect(out).not.toBeNull();
    // H1 stays first, block follows it, lead paragraph survives after.
    expect(out.indexOf('# Doc')).toBeLessThan(out.indexOf(TOC_OPEN));
    expect(out.indexOf(TOC_OPEN)).toBeLessThan(out.indexOf('lead'));
    expect(out).toContain('- [Doc](#doc)');
    expect(out).toContain('- [S1](#s1)');
    expect(out).toContain('- [S2](#s2)');
  });

  it('inserts after YAML frontmatter when there is no H1', () => {
    const doc = '---\ntitle: x\n---\n\n## A\n\n## B\n';
    const out = applyToc(doc, opts)!;
    expect(out).toMatch(/^---\ntitle: x\n---\n[\s\S]*<!-- toc -->/);
    // base = H2 → flush-left list.
    expect(out).toContain('- [A](#a)');
    expect(out).toContain('- [B](#b)');
    expect(out.indexOf('---\ntitle')).toBeLessThan(out.indexOf(TOC_OPEN));
  });

  it('returns null for a note with no headings', () => {
    expect(applyToc('just prose, no headings', opts)).toBeNull();
  });

  it('does not treat a `#` inside a fenced code block as a heading', () => {
    const doc = '# Real\n\n```\n# not a heading\n```\n';
    const out = applyToc(doc, opts)!;
    expect(out).toContain('- [Real](#real)');
    // The code block text stays in the note; it just must not become a TOC entry.
    expect(out).not.toContain('(#not-a-heading)');
  });
});

describe('applyToc - refresh in place', () => {
  it('is idempotent: a current block refreshes to no change', () => {
    const inserted = applyToc('# Doc\n\n## S1\n\n## S2\n', opts)!;
    expect(applyToc(inserted, opts)).toBeNull();
  });

  it('regenerates entries when a heading changes', () => {
    const inserted = applyToc('# Doc\n\n## S1\n\n## S2\n', opts)!;
    const edited = inserted.replace('## S2', '## Renamed');
    const refreshed = applyToc(edited, opts)!;
    expect(refreshed).toContain('- [Renamed](#renamed)');
    expect(refreshed).not.toContain('- [S2](#s2)');
    expect(applyToc(refreshed, opts)).toBeNull();
  });

  it('preserves the existing title (ignores the passed title on refresh)', () => {
    const inserted = applyToc('# Doc\n\n## S1\n', opts)!;
    expect(inserted).toContain('**Contents**');
    // Refresh with a different locale title must keep the stored one.
    expect(applyToc(inserted, { title: 'Inhalt' })).toBeNull();
  });

  it('refreshes a block the user moved to the bottom (position-independent)', () => {
    const inserted = applyToc('# Doc\n\n## S1\n\n## S2\n', opts)!;
    const block = inserted.match(/<!-- toc -->[\s\S]*?<!-- \/toc -->/)![0];
    const moved = inserted.replace(`${block}\n\n`, '') + `\n\n${block}\n`;
    const edited = moved.replace('## S1', '## First');
    const refreshed = applyToc(edited, opts)!;
    // Block stays at the bottom; only entries update.
    expect(refreshed.lastIndexOf(TOC_OPEN)).toBeGreaterThan(refreshed.indexOf('## First'));
    expect(refreshed).toContain('- [First](#first)');
  });

  it('drops the block when every heading is gone', () => {
    const inserted = applyToc('# Doc\n\n## S1\n', opts)!;
    const gutted = inserted.replace('# Doc', 'Doc').replace('## S1', 'S1');
    const out = applyToc(gutted, opts);
    expect(out).not.toBeNull();
    expect(hasToc(out!)).toBe(false);
  });
});

describe('removeToc', () => {
  it('removes the managed block', () => {
    const inserted = applyToc('# Doc\n\n## S1\n', opts)!;
    const out = removeToc(inserted)!;
    expect(out).not.toBeNull();
    expect(hasToc(out)).toBe(false);
    expect(out).toContain('# Doc');
    expect(out).toContain('## S1');
  });

  it('returns null when there is no block', () => {
    expect(removeToc('# Doc\n\n## S1\n')).toBeNull();
  });
});

describe('isTocStale', () => {
  it('is false for a freshly inserted block', () => {
    const inserted = applyToc('# Doc\n\n## S1\n\n## S2\n', opts)!;
    expect(isTocStale(inserted, opts)).toBe(false);
  });

  it('is true after a heading drifts from the TOC', () => {
    const inserted = applyToc('# Doc\n\n## S1\n', opts)!;
    const edited = inserted.replace('## S1', '## S1 changed');
    expect(isTocStale(edited, opts)).toBe(true);
  });

  it('is false for a note without a block', () => {
    expect(isTocStale('# Doc\n\n## S1\n', opts)).toBe(false);
  });

  it('is not flagged stale by a title/locale-only difference', () => {
    const inserted = applyToc('# Doc\n\n## S1\n', opts)!;
    expect(isTocStale(inserted, { title: 'Tabla de contenido' })).toBe(false);
  });
});

describe('tocInnerMarkdown', () => {
  it('returns the Markdown between the markers', () => {
    const inserted = applyToc('# Doc\n\n## S1\n', opts)!;
    expect(tocInnerMarkdown(inserted)).toBe('**Contents**\n\n- [Doc](#doc)\n  - [S1](#s1)');
  });

  it('returns null when there is no block', () => {
    expect(tocInnerMarkdown('# Doc\n\n## S1\n')).toBeNull();
  });
});

describe('toEditableTocBlock', () => {
  const inserted = applyToc('# Doc\n\n## S1\n\n## S2\n', opts)!;
  const inner = '<p><strong>Contents</strong></p>\n<ul><li><a href="#doc">Doc</a></li></ul>';
  const buttons = '<span class="note-toc-actions">x</span>';

  it('produces one atomic <nav> block carrying the buttons and inner html', () => {
    const out = toEditableTocBlock(inserted, inner, buttons);
    expect(out).toContain('<nav class="note-toc" data-note-toc><span class="note-toc-actions">x</span>');
    expect(out).toContain('</nav>');
    expect(out).not.toContain(TOC_OPEN);
    expect(out).not.toContain(TOC_CLOSE);
    // The nav must be a single line (no blank line inside) so marked treats it
    // as ONE html block -> one token -> one DOM node.
    const nav = out.match(/<nav[\s\S]*?<\/nav>/)![0];
    expect(nav.includes('\n')).toBe(false);
  });

  it('preserves the document newline count (keeps split-view scroll-sync aligned)', () => {
    const out = toEditableTocBlock(inserted, inner, buttons);
    const count = (s: string) => (s.match(/\n/g) ?? []).length;
    expect(count(out)).toBe(count(inserted));
  });

  it('inserts `$` sequences in the html literally (no replace-pattern expansion)', () => {
    const out = toEditableTocBlock(inserted, '<a href="#x">$&$1</a>', '$&');
    expect(out).toContain('<nav class="note-toc" data-note-toc>$&<a href="#x">$&$1</a>');
  });

  it('returns the content unchanged when there is no block', () => {
    expect(toEditableTocBlock('# plain note', inner, buttons)).toBe('# plain note');
  });
});

describe('parity with heading anchors', () => {
  it('TOC slugs equal the slugs extractHeadings stamps on the headings', () => {
    const doc = '# Łódź\n\n## Bezpieczeństwo\n\n## Bezpieczeństwo\n';
    const out = applyToc(doc, opts)!;
    const slugs = extractHeadings(doc).map((h) => h.slug);
    for (const slug of slugs) {
      expect(out).toContain(`(#${slug})`);
    }
    // Deduped second occurrence keeps the -1 suffix on both ends.
    expect(slugs).toContain('bezpieczeństwo-1');
    expect(out).toContain('(#bezpieczeństwo-1)');
  });
});
