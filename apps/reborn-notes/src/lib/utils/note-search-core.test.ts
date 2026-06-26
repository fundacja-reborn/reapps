import { describe, expect, it } from 'vitest';
import { findMatches, NOTE_SEARCH_MATCH_CAP } from './note-search-core';

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
