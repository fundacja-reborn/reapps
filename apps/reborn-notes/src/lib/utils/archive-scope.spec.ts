import { describe, it, expect } from 'vitest';
import type { FolderWithChildren } from '@reborn/types';
import {
  buildArchivedFolderScope,
  listArchiveRoots,
  pruneArchivedFolders,
  sameArchivedFolderScope
} from './archive-scope';

const AT = '2026-11-13T09:00:00.000Z';
const LATER = '2026-11-14T09:00:00.000Z';

function folder(
  id: string,
  children: FolderWithChildren[] = [],
  archived_at?: string
): FolderWithChildren {
  return {
    id,
    name: id.toUpperCase(),
    order_index: 0,
    is_archived: false,
    created_at: AT,
    updated_at: AT,
    ...(archived_at ? { archived_at } : {}),
    children
  };
}

// work
//   projects
//     old (archived)
//       deep
//         inner (archived later)
//     current
// attic (archived)
// home
function sampleTree(): FolderWithChildren[] {
  return [
    folder('work', [
      folder('projects', [
        folder('old', [folder('deep', [folder('inner', [], LATER)])], AT),
        folder('current')
      ])
    ]),
    folder('attic', [], AT),
    folder('home')
  ];
}

describe('buildArchivedFolderScope', () => {
  it('marks an archived folder and its whole subtree with the topmost root', () => {
    const scope = buildArchivedFolderScope(sampleTree());
    expect([...scope.keys()].sort()).toEqual(['attic', 'deep', 'inner', 'old']);
    expect(scope.get('old')).toEqual({ rootId: 'old', at: AT });
    expect(scope.get('deep')).toEqual({ rootId: 'old', at: AT });
    // Archived inside an archived folder: still under the outer root.
    expect(scope.get('inner')).toEqual({ rootId: 'old', at: AT });
    expect(scope.get('attic')).toEqual({ rootId: 'attic', at: AT });
  });

  it('leaves active folders out, including the parents of an archived one', () => {
    const scope = buildArchivedFolderScope(sampleTree());
    for (const id of ['work', 'projects', 'current', 'home']) expect(scope.has(id)).toBe(false);
  });

  it('is empty for a tree without markers', () => {
    expect(buildArchivedFolderScope([folder('a', [folder('b')])]).size).toBe(0);
  });
});

describe('pruneArchivedFolders', () => {
  it('removes archived folders with everything below them', () => {
    const pruned = pruneArchivedFolders(sampleTree());
    expect(pruned.map((f) => f.id)).toEqual(['work', 'home']);
    const projects = pruned[0].children![0];
    expect(projects.children!.map((f: FolderWithChildren) => f.id)).toEqual(['current']);
  });

  it('returns the same tree object when nothing is archived', () => {
    const tree = [folder('a', [folder('b')])];
    expect(pruneArchivedFolders(tree)).toBe(tree);
  });

  it('does not mutate the full tree', () => {
    const tree = sampleTree();
    pruneArchivedFolders(tree);
    expect(tree[0].children![0].children!.map((f: FolderWithChildren) => f.id)).toEqual([
      'old',
      'current'
    ]);
  });
});

describe('listArchiveRoots', () => {
  it('lists topmost archived folders with their active path and subtree ids', () => {
    const roots = listArchiveRoots(sampleTree());
    expect(roots.map((r) => r.folder.id)).toEqual(['old', 'attic']);
    expect(roots[0].path).toEqual(['WORK', 'PROJECTS']);
    expect(roots[0].folderIds).toEqual(['old', 'deep', 'inner']);
    expect(roots[0].at).toBe(AT);
    expect(roots[1].path).toEqual([]);
    expect(roots[1].folderIds).toEqual(['attic']);
  });

  it('surfaces an inner archived folder once the outer one is restored', () => {
    const tree = sampleTree();
    delete tree[0].children![0].children![0].archived_at; // restore "old"
    const roots = listArchiveRoots(tree);
    expect(roots.map((r) => r.folder.id)).toEqual(['inner', 'attic']);
    expect(roots[0].path).toEqual(['WORK', 'PROJECTS', 'OLD', 'DEEP']);
    expect(roots[0].at).toBe(LATER);
  });
});

describe('sameArchivedFolderScope', () => {
  it('compares ids, roots and dates', () => {
    const a = buildArchivedFolderScope(sampleTree());
    expect(sameArchivedFolderScope(a, buildArchivedFolderScope(sampleTree()))).toBe(true);
    const moved = sampleTree();
    moved[1].archived_at = LATER;
    expect(sameArchivedFolderScope(a, buildArchivedFolderScope(moved))).toBe(false);
    expect(sameArchivedFolderScope(a, new Map())).toBe(false);
  });
});
