import { describe, it, expect } from 'vitest';
import { tocHiddenSpans, TOC_OPEN, TOC_CLOSE } from './toc';
import { findMatches, excludeMatchesInSpans } from './note-search-core';

// A realistic managed TOC block (markers + bold title + nested link list).
const toc = [
  TOC_OPEN,
  '',
  '**Table of contents**',
  '',
  '- [Heading anchors](#heading-anchors)',
  '  - [Nested anchor](#nested-anchor)',
  '',
  TOC_CLOSE
].join('\n');

describe('tocHiddenSpans', () => {
  it('returns [] when there is no managed block', () => {
    expect(tocHiddenSpans('# just a note\n\nbody text')).toEqual([]);
  });

  it('covers the comment markers and `](#slug)` targets, not the labels', () => {
    const content = `intro\n\n${toc}\n\nbody`;
    const spans = tocHiddenSpans(content);
    const covers = (needle: string) => {
      const at = content.indexOf(needle);
      return spans.some((s) => at >= s.from && at < s.to);
    };
    expect(covers(TOC_OPEN)).toBe(true);
    expect(covers(TOC_CLOSE)).toBe(true);
    expect(covers('#heading-anchors')).toBe(true);
    expect(covers('#nested-anchor')).toBe(true);
    // The visible label text (before the `](`) stays outside the hidden spans.
    expect(covers('Heading anchors]')).toBe(false);
  });

  it('drops a slug match but keeps body and label matches (Live Preview count)', () => {
    const content = `intro anchors\n\n${toc}\n\nbody`;
    const all = findMatches(content, 'anchors', false);
    const visible = excludeMatchesInSpans(all, tocHiddenSpans(content));
    // "anchors" appears in the body, the label, and the slug → 3 raw matches;
    // the slug occurrence is filtered out → 2 visible.
    expect(all).toHaveLength(3);
    expect(visible).toHaveLength(2);
  });
});
