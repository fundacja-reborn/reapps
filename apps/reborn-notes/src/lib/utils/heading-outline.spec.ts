import { describe, it, expect } from 'vitest';

import { slugifyHeading, assignHeadingSlugs, extractHeadings } from './heading-outline';
import fixture from './__fixtures__/heading-slug-cases.json';

describe('slugifyHeading', () => {
  for (const { text, slug } of fixture.slugs) {
    it(`slugifies ${JSON.stringify(text)} → ${slug}`, () => {
      expect(slugifyHeading(text)).toBe(slug);
    });
  }

  it('trims surrounding whitespace and hyphens', () => {
    expect(slugifyHeading('  Leading and trailing  ')).toBe('leading-and-trailing');
    expect(slugifyHeading('- dashy -')).toBe('dashy');
  });

  it('returns empty string when nothing slug-able remains', () => {
    expect(slugifyHeading('🔥💧')).toBe('');
    expect(slugifyHeading('   ')).toBe('');
  });

  it('keeps underscores', () => {
    expect(slugifyHeading('snake_case_name')).toBe('snake_case_name');
  });
});

describe('assignHeadingSlugs', () => {
  it('deduplicates collisions GitHub-style (-1, -2, …)', () => {
    expect(assignHeadingSlugs(fixture.dedup.texts)).toEqual(fixture.dedup.slugs);
  });

  it('falls back to "section" for un-slug-able headings, deduplicated', () => {
    expect(assignHeadingSlugs(['🔥', '💧', 'Real'])).toEqual(['section', 'section-1', 'real']);
  });

  it('treats case-folded duplicates as collisions', () => {
    expect(assignHeadingSlugs(['Setup', 'SETUP'])).toEqual(['setup', 'setup-1']);
  });
});

describe('extractHeadings', () => {
  it('matches the canonical document fixture', () => {
    expect(extractHeadings(fixture.doc.markdown)).toEqual(fixture.doc.headings);
  });

  it('skips leading YAML frontmatter', () => {
    const md = '---\ntitle: x\n---\n# Real Heading\n';
    expect(extractHeadings(md)).toEqual([
      { depth: 1, text: 'Real Heading', slug: 'real-heading', line: 4 }
    ]);
  });

  it('does not treat `#` inside fenced code as a heading', () => {
    const md = '# Top\n\n```\n# not a heading\n```\n\n## Bottom\n';
    expect(extractHeadings(md).map((h) => h.text)).toEqual(['Top', 'Bottom']);
  });

  it('handles tilde fences too', () => {
    const md = '# Top\n\n~~~\n# not a heading\n~~~\n\n## Bottom\n';
    expect(extractHeadings(md).map((h) => h.text)).toEqual(['Top', 'Bottom']);
  });

  it('requires a space after the # (CommonMark): "#foo" is not a heading', () => {
    expect(extractHeadings('#foo\n')).toEqual([]);
  });

  it('strips closing hashes ("## Foo ##" → "Foo")', () => {
    expect(extractHeadings('## Foo ##\n')[0]).toMatchObject({ depth: 2, text: 'Foo', slug: 'foo' });
  });

  it('reports 1-based source line numbers', () => {
    const md = 'para\n\n## Second line three\n\ntext\n\n### Line seven\n';
    expect(extractHeadings(md).map((h) => h.line)).toEqual([3, 7]);
  });

  it('caps heading depth at 6 (7 hashes is not a heading)', () => {
    expect(extractHeadings('####### too deep\n')).toEqual([]);
    expect(extractHeadings('###### depth six\n')[0]).toMatchObject({ depth: 6 });
  });

  it('returns an empty list for content with no headings', () => {
    expect(extractHeadings('just a paragraph\nand another line\n')).toEqual([]);
  });
});
