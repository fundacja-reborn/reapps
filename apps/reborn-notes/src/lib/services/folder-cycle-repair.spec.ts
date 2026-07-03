import { describe, it, expect } from 'vitest';
import { findFolderCycles, pickCycleRepairTarget, planCycleRepairs } from './folder-cycle-repair';

// Regression tests for audit 013 N2: the server accepts concurrent
// cross-device moves that close a parent_id cycle; pull detects the cycle in
// the local mirror and reparents exactly one member per cycle to the root.

function f(id: string, parent_id?: string, updated_at = '2026-07-01T00:00:00.000Z') {
  return { id, parent_id, updated_at };
}

function sorted(cycles: string[][]): string[][] {
  return cycles.map((c) => [...c].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));
}

describe('findFolderCycles', () => {
  it('empty input → no cycles', () => {
    expect(findFolderCycles([])).toEqual([]);
  });

  it('a healthy tree has no cycles', () => {
    const rows = [f('root'), f('a', 'root'), f('b', 'root'), f('c', 'a')];
    expect(findFolderCycles(rows)).toEqual([]);
  });

  it('detects the two-device A↔B cycle', () => {
    const rows = [f('a', 'b'), f('b', 'a')];
    expect(sorted(findFolderCycles(rows))).toEqual([['a', 'b']]);
  });

  it('detects a direct self-parent as a one-member cycle', () => {
    expect(findFolderCycles([f('a', 'a')])).toEqual([['a']]);
  });

  it('detects a deep cycle (a→b→c→a)', () => {
    const rows = [f('a', 'b'), f('b', 'c'), f('c', 'a')];
    expect(sorted(findFolderCycles(rows))).toEqual([['a', 'b', 'c']]);
  });

  it('folders hanging off a cycle are NOT members (reparenting one member frees them)', () => {
    // sub and leaf dangle from the a↔b loop - only the loop is the cycle.
    const rows = [f('a', 'b'), f('b', 'a'), f('sub', 'a'), f('leaf', 'sub')];
    expect(sorted(findFolderCycles(rows))).toEqual([['a', 'b']]);
  });

  it('reports each independent cycle exactly once', () => {
    const rows = [f('a', 'b'), f('b', 'a'), f('x', 'y'), f('y', 'x'), f('root'), f('kid', 'root')];
    expect(sorted(findFolderCycles(rows))).toEqual([
      ['a', 'b'],
      ['x', 'y']
    ]);
  });

  it('a dangling parent_id terminates the walk without reporting a cycle', () => {
    const rows = [f('orphan', 'gone'), f('root')];
    expect(findFolderCycles(rows)).toEqual([]);
  });
});

describe('pickCycleRepairTarget', () => {
  it('picks the most recently updated member (the move that closed the cycle)', () => {
    const rows = [
      f('a', 'b', '2026-07-01T00:00:00.000Z'),
      f('b', 'a', '2026-07-01T00:00:05.000Z')
    ];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(pickCycleRepairTarget(['a', 'b'], byId)).toBe('b');
  });

  it('breaks timestamp ties by the greater id (deterministic across devices)', () => {
    const rows = [f('a', 'b'), f('b', 'a')];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(pickCycleRepairTarget(['a', 'b'], byId)).toBe('b');
    expect(pickCycleRepairTarget(['b', 'a'], byId)).toBe('b');
  });
});

describe('planCycleRepairs', () => {
  it('returns one repair target per cycle and nothing for healthy trees', () => {
    const rows = [
      f('root'),
      f('kid', 'root'),
      f('a', 'b', '2026-07-01T00:00:00.000Z'),
      f('b', 'a', '2026-07-01T00:00:05.000Z'),
      f('x', 'y', '2026-07-02T00:00:00.000Z'),
      f('y', 'x', '2026-07-01T00:00:00.000Z')
    ];
    expect(planCycleRepairs(rows).sort()).toEqual(['b', 'x']);
    expect(planCycleRepairs([f('root'), f('kid', 'root')])).toEqual([]);
  });
});
