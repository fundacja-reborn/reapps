import { describe, it, expect } from 'vitest';
import {
  type DedupCandidate,
  buildMergedContent,
  groupDuplicates
} from './periodic-dedup.core';

function candidate(over: Partial<DedupCandidate> & Pick<DedupCandidate, 'id'>): DedupCandidate {
  return {
    folderId: 'f1',
    kind: 'daily',
    anchor: '2026-06-08',
    createdAt: '2026-06-08T10:00:00.000Z',
    ...over
  };
}

describe('periodic-dedup core - groupDuplicates', () => {
  it('returns nothing when every (folder, kind, anchor) is unique', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a', anchor: '2026-06-08' }),
      candidate({ id: 'b', anchor: '2026-06-09' }),
      candidate({ id: 'c', anchor: '2026-06-10' })
    ]);
    expect(groups).toEqual([]);
  });

  it('groups two notes sharing folder+kind+anchor and keeps the oldest first', () => {
    const groups = groupDuplicates([
      candidate({ id: 'younger', createdAt: '2026-06-08T12:00:00.000Z' }),
      candidate({ id: 'older', createdAt: '2026-06-08T09:00:00.000Z' })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id)).toEqual(['older', 'younger']);
    expect(groups[0]).toMatchObject({ folderId: 'f1', kind: 'daily', anchor: '2026-06-08' });
  });

  it('does NOT group same anchor across different folders', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a', folderId: 'f1' }),
      candidate({ id: 'b', folderId: 'f2' })
    ]);
    expect(groups).toEqual([]);
  });

  it('does NOT group same anchor across different kinds', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a', kind: 'daily', anchor: '2026-06-01' }),
      candidate({ id: 'b', kind: 'monthly', anchor: '2026-06-01' })
    ]);
    expect(groups).toEqual([]);
  });

  it('handles three+ copies and orders them oldest-first', () => {
    const groups = groupDuplicates([
      candidate({ id: 'c', createdAt: '2026-06-08T15:00:00.000Z' }),
      candidate({ id: 'a', createdAt: '2026-06-08T08:00:00.000Z' }),
      candidate({ id: 'b', createdAt: '2026-06-08T11:00:00.000Z' })
    ]);
    expect(groups[0].members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks createdAt ties deterministically by id', () => {
    const ts = '2026-06-08T08:00:00.000Z';
    const groups = groupDuplicates([
      candidate({ id: 'zeta', createdAt: ts }),
      candidate({ id: 'alpha', createdAt: ts })
    ]);
    expect(groups[0].members.map((m) => m.id)).toEqual(['alpha', 'zeta']);
  });

  it('produces independent groups for distinct anchors in the same folder', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a1', anchor: '2026-06-08' }),
      candidate({ id: 'a2', anchor: '2026-06-08' }),
      candidate({ id: 'b1', anchor: '2026-06-09' }),
      candidate({ id: 'b2', anchor: '2026-06-09' })
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.members.length === 2)).toBe(true);
  });
});

describe('periodic-dedup core - buildMergedContent', () => {
  const SEP = '---\n*merged*';

  it('appends younger content under a separator', () => {
    const merged = buildMergedContent('canonical body', [{ content: 'younger body', separator: SEP }]);
    expect(merged).toBe('canonical body\n\n---\n*merged*\n\nyounger body');
  });

  it('skips empty younger copies entirely (no stray separator)', () => {
    const merged = buildMergedContent('canonical body', [
      { content: '   \n  ', separator: SEP }
    ]);
    expect(merged).toBe('canonical body');
  });

  it('omits the leading separator when the canonical body is empty', () => {
    const merged = buildMergedContent('', [{ content: 'younger body', separator: SEP }]);
    expect(merged).toBe('---\n*merged*\n\nyounger body');
  });

  it('chains multiple non-empty additions, each with its own separator', () => {
    const merged = buildMergedContent('A', [
      { content: 'B', separator: '---\n*s1*' },
      { content: 'C', separator: '---\n*s2*' }
    ]);
    expect(merged).toBe('A\n\n---\n*s1*\n\nB\n\n---\n*s2*\n\nC');
  });

  it('drops empty additions but keeps the non-empty ones', () => {
    const merged = buildMergedContent('A', [
      { content: '', separator: '---\n*s1*' },
      { content: 'C', separator: '---\n*s2*' }
    ]);
    expect(merged).toBe('A\n\n---\n*s2*\n\nC');
  });

  it('trims trailing whitespace from canonical and additions', () => {
    const merged = buildMergedContent('A   \n\n', [{ content: 'B\n\n  ', separator: SEP }]);
    expect(merged).toBe('A\n\n---\n*merged*\n\nB');
  });

  it('returns an empty string when everything is empty', () => {
    expect(buildMergedContent('', [{ content: '  ', separator: SEP }])).toBe('');
  });
});
