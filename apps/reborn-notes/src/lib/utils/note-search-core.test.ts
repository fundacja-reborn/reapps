import { describe, expect, it } from 'vitest';
import { findMatches, excludeMatchesInSpans, NOTE_SEARCH_MATCH_CAP } from './note-search-core';

describe('findMatches', () => {
  it('returns empty for an empty query', () => {
    expect(findMatches('hello world', '', false)).toEqual([]);
  });

  it('finds all non-overlapping matches with correct offsets', () => {
    expect(findMatches('abcabc', 'bc', false)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 }
    ]);
  });

  it('does not produce overlapping matches', () => {
    // "aa" in "aaaa" -> positions 0 and 2, not 0,1,2
    expect(findMatches('aaaa', 'aa', false)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 }
    ]);
  });

  it('is case-insensitive by default', () => {
    expect(findMatches('Foo FOO foo', 'foo', false)).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 }
    ]);
  });

  it('respects case-sensitive mode', () => {
    expect(findMatches('Foo FOO foo', 'foo', true)).toEqual([{ from: 8, to: 11 }]);
  });

  it('treats regex metacharacters as literal text', () => {
    expect(findMatches('a.b a.b axb', 'a.b', false)).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 }
    ]);
    expect(findMatches('price (5) and (6)', '(5)', false)).toEqual([{ from: 6, to: 9 }]);
  });

  it('caps the number of returned matches', () => {
    const text = 'x'.repeat(NOTE_SEARCH_MATCH_CAP + 50);
    expect(findMatches(text, 'x', false)).toHaveLength(NOTE_SEARCH_MATCH_CAP);
  });
});

describe('findMatches with Arabic diacritics', () => {
  const slice = (text: string, match: { from: number; to: number }) =>
    text.slice(match.from, match.to);

  it('finds a plain query in vocalized text and reports offsets in the original', () => {
    const text = 'قَدْ كَتَبَ الدرس';
    const [match] = findMatches(text, 'كتب', false);
    expect(slice(text, match)).toBe('كَتَبَ');
    expect(match.from).toBe(text.indexOf('ك'));
  });

  it('finds a vocalized query in plain text', () => {
    const text = 'قد كتب الدرس';
    const [match] = findMatches(text, 'كَتَبَ', false);
    expect(slice(text, match)).toBe('كتب');
  });

  it('finds every form of the same word', () => {
    const text = 'كتب كَتَبَ كُتُب كـتـب';
    expect(findMatches(text, 'كتب', false)).toHaveLength(4);
  });

  it('honors the case-sensitive flag for the Latin part of a mixed query', () => {
    const text = 'Note كَتَبَ';
    expect(findMatches(text, 'note كتب', false)).toHaveLength(1);
    expect(findMatches(text, 'note كتب', true)).toHaveLength(0);
  });

  it('finds nothing for a query of marks alone', () => {
    expect(findMatches('كَتَبَ', 'َ', false)).toEqual([]);
  });

  it('does not change Latin matching', () => {
    expect(findMatches('żółć zolc', 'zolc', false)).toEqual([{ from: 5, to: 9 }]);
  });
});

describe('excludeMatchesInSpans', () => {
  const m = (from: number, to: number) => ({ from, to });

  it('returns the input unchanged when there are no spans', () => {
    const matches = [m(0, 3), m(5, 8)];
    expect(excludeMatchesInSpans(matches, [])).toBe(matches);
  });

  it('drops matches that overlap an excluded span', () => {
    const matches = [m(0, 3), m(10, 13), m(20, 23)];
    // span [8,15) overlaps the middle match only
    expect(excludeMatchesInSpans(matches, [{ from: 8, to: 15 }])).toEqual([m(0, 3), m(20, 23)]);
  });

  it('drops a match that is only partially inside a span', () => {
    // match [4,7) overlaps span [6,10) at one character → dropped
    expect(excludeMatchesInSpans([m(4, 7)], [{ from: 6, to: 10 }])).toEqual([]);
  });

  it('keeps matches that merely touch a span boundary (half-open)', () => {
    // match [0,5) ends exactly where span [5,9) starts → no overlap
    expect(excludeMatchesInSpans([m(0, 5)], [{ from: 5, to: 9 }])).toEqual([m(0, 5)]);
  });

  it('drops a match overlapping any of several spans', () => {
    const spans = [
      { from: 0, to: 4 },
      { from: 20, to: 24 }
    ];
    expect(excludeMatchesInSpans([m(2, 5), m(10, 12), m(22, 25)], spans)).toEqual([m(10, 12)]);
  });
});
