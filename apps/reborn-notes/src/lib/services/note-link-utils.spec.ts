import { describe, it, expect } from 'vitest';
import { extractNoteLinkTargets, intersectIds } from './note-link-utils';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '123e4567-e89b-12d3-a456-426614174000';
const C = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('extractNoteLinkTargets', () => {
  it('extracts a single internal link target', () => {
    expect([...extractNoteLinkTargets(`See [Note A](note:${A}).`)]).toEqual([A]);
  });

  it('extracts multiple distinct targets', () => {
    const content = `[A](note:${A}) and [B](note:${B}) and [C](note:${C})`;
    expect(extractNoteLinkTargets(content)).toEqual(new Set([A, B, C]));
  });

  it('de-duplicates repeated links to the same note', () => {
    const content = `[x](note:${A}) ... [y](note:${A})`;
    expect([...extractNoteLinkTargets(content)]).toEqual([A]);
  });

  it('excludes the note itself (no self-backlink), case-insensitively', () => {
    const content = `[self](note:${A}) [other](note:${B})`;
    expect(extractNoteLinkTargets(content, A)).toEqual(new Set([B]));
    // selfId given in a different case must still be excluded
    expect(extractNoteLinkTargets(content, A.toUpperCase())).toEqual(new Set([B]));
  });

  it('is case-insensitive and lowercases the captured id', () => {
    const upper = A.toUpperCase();
    expect([...extractNoteLinkTargets(`[a](NOTE:${upper})`)]).toEqual([A]);
  });

  it('ignores external links and other URI schemes', () => {
    const content = `[ext](https://example.com) [mail](mailto:a@b.c) [img](image:${A})`;
    expect(extractNoteLinkTargets(content).size).toBe(0);
  });

  it('does not match a bare note: string that is not a markdown link', () => {
    // No `](` prefix → not a link destination, must not be picked up.
    expect(extractNoteLinkTargets(`reference note:${A} inline`).size).toBe(0);
  });

  it('ignores malformed UUIDs', () => {
    expect(extractNoteLinkTargets(`[bad](note:not-a-uuid)`).size).toBe(0);
    expect(extractNoteLinkTargets(`[short](note:550e8400-e29b-41d4-a716)`).size).toBe(0);
  });

  it('returns an empty set for empty or link-free content', () => {
    expect(extractNoteLinkTargets('').size).toBe(0);
    expect(extractNoteLinkTargets('Plain text, no links.').size).toBe(0);
  });
});

describe('intersectIds (mutual links)', () => {
  it('returns the ids present in both lists', () => {
    expect(intersectIds([A, B, C], [B, C])).toEqual(new Set([B, C]));
  });

  it('returns an empty set when there is no overlap', () => {
    expect(intersectIds([A], [B, C]).size).toBe(0);
  });

  it('is case-insensitive and lowercases the result', () => {
    expect(intersectIds([A.toUpperCase()], [A])).toEqual(new Set([A]));
    expect(intersectIds([A], [A.toUpperCase()])).toEqual(new Set([A]));
  });

  it('de-duplicates repeated ids in either input', () => {
    expect([...intersectIds([A, A, B], [A, A])]).toEqual([A]);
  });

  it('returns an empty set when either side is empty', () => {
    expect(intersectIds([], [A, B]).size).toBe(0);
    expect(intersectIds([A, B], []).size).toBe(0);
  });

  it('accepts Set inputs (the graph passes id sets)', () => {
    expect(intersectIds(new Set([A, B]), new Set([B, C]))).toEqual(new Set([B]));
  });
});
