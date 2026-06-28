import { describe, it, expect } from 'vitest';
import {
  orderCanonicalFirst,
  buildFolderDedupGroup,
  detectFolderDuplicateGroups,
  type FolderInfo,
  type FolderDedupCandidate,
  type PeriodicFolderContext
} from './periodic-folder-dedup.core';

function cand(p: Partial<FolderDedupCandidate> & { id: string }): FolderDedupCandidate {
  return { createdAt: '', noteCount: 0, hasStampedNotes: false, ...p };
}

function folder(p: Partial<FolderInfo> & { id: string }): FolderInfo {
  return {
    name: p.id,
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    noteCount: 0,
    stampedKinds: [],
    ...p
  };
}

const DEFAULT_NAMES: PeriodicFolderContext['defaultNamesByKind'] = {
  daily: new Set(['Daily Notes', 'Dziennik']),
  weekly: new Set(['Weekly Notes', 'Tygodnik']),
  monthly: new Set(['Monthly Notes', 'Miesięcznik'])
};

function ctx(settings: Partial<Record<'daily' | 'weekly' | 'monthly', string>> = {}): PeriodicFolderContext {
  return { defaultNamesByKind: DEFAULT_NAMES, settingsFolderIdByKind: settings };
}

describe('orderCanonicalFirst', () => {
  it('prefers a stamped folder over an older empty shell', () => {
    const ordered = orderCanonicalFirst([
      cand({ id: 'shell', hasStampedNotes: false, noteCount: 0, createdAt: '2025-01-01' }),
      cand({ id: 'real', hasStampedNotes: true, noteCount: 3, createdAt: '2026-06-01' })
    ]);
    expect(ordered[0].id).toBe('real');
  });

  it('among stamped folders, most notes then oldest then id', () => {
    const ordered = orderCanonicalFirst([
      cand({ id: 'b', hasStampedNotes: true, noteCount: 2, createdAt: '2026-02-01' }),
      cand({ id: 'a', hasStampedNotes: true, noteCount: 5, createdAt: '2026-03-01' }),
      cand({ id: 'c', hasStampedNotes: true, noteCount: 5, createdAt: '2026-01-01' })
    ]);
    // a and c both have 5 notes; c is older -> c wins, then a, then b.
    expect(ordered.map((o) => o.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('buildFolderDedupGroup', () => {
  it('returns null for fewer than two candidates', () => {
    expect(buildFolderDedupGroup('daily', [])).toBeNull();
    expect(buildFolderDedupGroup('daily', [cand({ id: 'a' })])).toBeNull();
  });

  it('keeps the canonical and lists the rest, summing notes to move', () => {
    const group = buildFolderDedupGroup('daily', [
      cand({ id: 'real', hasStampedNotes: true, noteCount: 4, createdAt: '2026-01-01' }),
      cand({ id: 'dup1', noteCount: 1 }),
      cand({ id: 'dup2', noteCount: 0 })
    ]);
    expect(group).not.toBeNull();
    expect(group!.canonicalId).toBe('real');
    expect(group!.duplicateIds.sort()).toEqual(['dup1', 'dup2']);
    expect(group!.folderCount).toBe(3);
    expect(group!.notesToMove).toBe(1); // dup1(1) + dup2(0); the canonical's notes stay put
  });
});

describe('detectFolderDuplicateGroups', () => {
  it('groups two stamped daily folders, keeping the one with more notes', () => {
    const groups = detectFolderDuplicateGroups(
      [
        folder({ id: 'big', name: 'Daily Notes', noteCount: 9, stampedKinds: ['daily'] }),
        folder({ id: 'small', name: 'Daily Notes', noteCount: 1, stampedKinds: ['daily'] })
      ],
      ctx()
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('daily');
    expect(groups[0].canonicalId).toBe('big');
    expect(groups[0].duplicateIds).toEqual(['small']);
    expect(groups[0].notesToMove).toBe(1);
  });

  it('absorbs empty name-matched shells into the real stamped folder', () => {
    const groups = detectFolderDuplicateGroups(
      [
        folder({ id: 'real', name: 'Daily Notes', noteCount: 5, stampedKinds: ['daily'] }),
        folder({ id: 'shell1', name: 'Daily Notes', noteCount: 0 }),
        folder({ id: 'shell2', name: 'Daily Notes', noteCount: 0 })
      ],
      ctx()
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].canonicalId).toBe('real');
    expect(groups[0].duplicateIds.sort()).toEqual(['shell1', 'shell2']);
    expect(groups[0].notesToMove).toBe(0);
  });

  it('matches across locale default names (Dziennik + Daily Notes)', () => {
    const groups = detectFolderDuplicateGroups(
      [
        folder({ id: 'pl', name: 'Dziennik', noteCount: 3, stampedKinds: ['daily'] }),
        folder({ id: 'en', name: 'Daily Notes', noteCount: 0 })
      ],
      ctx()
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].canonicalId).toBe('pl');
    expect(groups[0].duplicateIds).toEqual(['en']);
  });

  it('does not group a single folder', () => {
    const groups = detectFolderDuplicateGroups(
      [folder({ id: 'only', name: 'Daily Notes', noteCount: 2, stampedKinds: ['daily'] })],
      ctx()
    );
    expect(groups).toHaveLength(0);
  });

  it('leaves purely coincidental same-named empty folders alone (no periodic linkage)', () => {
    const groups = detectFolderDuplicateGroups(
      [
        folder({ id: 'a', name: 'Daily Notes', noteCount: 0 }),
        folder({ id: 'b', name: 'Daily Notes', noteCount: 0 })
      ],
      ctx() // no settings pointer, no stamps -> not confirmed periodic
    );
    expect(groups).toHaveLength(0);
  });

  it('forms a group of empty shells once the settings pointer confirms one of them', () => {
    const groups = detectFolderDuplicateGroups(
      [
        folder({ id: 'a', name: 'Daily Notes', noteCount: 0 }),
        folder({ id: 'b', name: 'Daily Notes', noteCount: 0 })
      ],
      ctx({ daily: 'a' })
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].folderCount).toBe(2);
  });

  it('never claims a folder that holds another kind via a name match', () => {
    // "Daily Notes" name but it actually holds WEEKLY notes -> not a daily candidate.
    const groups = detectFolderDuplicateGroups(
      [
        folder({ id: 'realDaily', name: 'Daily Notes', noteCount: 2, stampedKinds: ['daily'] }),
        folder({ id: 'mislabeled', name: 'Daily Notes', noteCount: 2, stampedKinds: ['weekly'] })
      ],
      ctx()
    );
    // Only realDaily is a daily candidate -> single -> no daily group. mislabeled is
    // a lone weekly folder -> no weekly group either.
    expect(groups).toHaveLength(0);
  });

  it('skips folders carrying more than one periodic kind (ambiguous)', () => {
    const groups = detectFolderDuplicateGroups(
      [
        folder({ id: 'mixed', name: 'Daily Notes', noteCount: 4, stampedKinds: ['daily', 'weekly'] }),
        folder({ id: 'real', name: 'Daily Notes', noteCount: 2, stampedKinds: ['daily'] })
      ],
      ctx()
    );
    // mixed is skipped, leaving a single daily candidate -> no group.
    expect(groups).toHaveLength(0);
  });

  it('ignores non-root folders', () => {
    const groups = detectFolderDuplicateGroups(
      [
        folder({ id: 'root', name: 'Daily Notes', noteCount: 3, stampedKinds: ['daily'] }),
        folder({ id: 'child', name: 'Daily Notes', parentId: 'root', noteCount: 2, stampedKinds: ['daily'] })
      ],
      ctx()
    );
    expect(groups).toHaveLength(0);
  });

  it('detects independent groups for different kinds at once', () => {
    const groups = detectFolderDuplicateGroups(
      [
        folder({ id: 'd1', name: 'Daily Notes', noteCount: 2, stampedKinds: ['daily'] }),
        folder({ id: 'd2', name: 'Daily Notes', noteCount: 0 }),
        folder({ id: 'm1', name: 'Monthly Notes', noteCount: 1, stampedKinds: ['monthly'] }),
        folder({ id: 'm2', name: 'Monthly Notes', noteCount: 0 })
      ],
      ctx()
    );
    expect(groups.map((g) => g.kind).sort()).toEqual(['daily', 'monthly']);
  });
});
