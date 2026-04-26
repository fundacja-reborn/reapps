import { describe, it, expect } from 'vitest';
import {
  findChildrenOfParent,
  buildBreadcrumb,
  buildPathString,
  getAncestorIds,
  getDescendantFolderIds,
  flattenFolderTree,
  flattenFoldersWithDepth
} from './folder-helpers';
import type { FolderWithChildren } from '@reborn/types';

function makeFolder(id: string, name: string, children: FolderWithChildren[] = []): FolderWithChildren {
  return {
    id,
    name,
    parent_id: null,
    position: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    children
  } as unknown as FolderWithChildren;
}

// Fixture tree:
//   Reborn 1 on 1
//     PT00 - Basia
//     PT01 - Agata
//   Dev
//     Reapps
//       architecture
//       development
//         guidelines
//   People
const tree: FolderWithChildren[] = [
  makeFolder('r1on1', 'Reborn 1 on 1', [
    makeFolder('pt00', 'PT00 - Basia'),
    makeFolder('pt01', 'PT01 - Agata')
  ]),
  makeFolder('dev', 'Dev', [
    makeFolder('reapps', 'Reapps', [
      makeFolder('arch', 'architecture'),
      makeFolder('devsub', 'development', [makeFolder('guide', 'guidelines')])
    ])
  ]),
  makeFolder('people', 'People')
];

describe('findChildrenOfParent', () => {
  it('returns root-level folders for null', () => {
    const result = findChildrenOfParent(tree, null);
    expect(result.map((f) => f.id)).toEqual(['r1on1', 'dev', 'people']);
  });

  it('returns direct children of a folder', () => {
    const result = findChildrenOfParent(tree, 'reapps');
    expect(result.map((f) => f.id)).toEqual(['arch', 'devsub']);
  });

  it('returns empty array for a leaf folder', () => {
    expect(findChildrenOfParent(tree, 'pt00')).toEqual([]);
  });

  it('returns empty array for a non-existent id', () => {
    expect(findChildrenOfParent(tree, 'nope')).toEqual([]);
  });
});

describe('buildBreadcrumb', () => {
  it('returns empty array for null', () => {
    expect(buildBreadcrumb(tree, null)).toEqual([]);
  });

  it('returns full root-to-folder path for a deep folder', () => {
    const crumbs = buildBreadcrumb(tree, 'guide');
    expect(crumbs.map((c) => c.name)).toEqual(['Dev', 'Reapps', 'development', 'guidelines']);
  });

  it('returns a single-entry path for a top-level folder', () => {
    const crumbs = buildBreadcrumb(tree, 'dev');
    expect(crumbs).toEqual([{ id: 'dev', name: 'Dev' }]);
  });

  it('returns empty array for an unknown id', () => {
    expect(buildBreadcrumb(tree, 'nope')).toEqual([]);
  });
});

describe('buildPathString', () => {
  it('returns ancestor path without the folder itself', () => {
    expect(buildPathString(tree, 'guide')).toBe('Dev / Reapps / development');
  });

  it('returns empty string for top-level folder', () => {
    expect(buildPathString(tree, 'dev')).toBe('');
  });

  it('respects custom separator', () => {
    expect(buildPathString(tree, 'arch', ' › ')).toBe('Dev › Reapps');
  });
});

describe('getDescendantFolderIds', () => {
  it('returns root + all descendants for a folder with subtree', () => {
    const ids = getDescendantFolderIds(tree, 'dev');
    expect(ids.sort()).toEqual(['arch', 'dev', 'devsub', 'guide', 'reapps'].sort());
  });

  it('returns just the folder id for a leaf', () => {
    expect(getDescendantFolderIds(tree, 'arch')).toEqual(['arch']);
  });

  it('returns just the folder id for a top-level folder with no children', () => {
    expect(getDescendantFolderIds(tree, 'people')).toEqual(['people']);
  });

  it('returns empty array for a non-existent folder id', () => {
    expect(getDescendantFolderIds(tree, 'nope')).toEqual([]);
  });

  it('returns empty array for an empty tree', () => {
    expect(getDescendantFolderIds([], 'anything')).toEqual([]);
  });

  it('places the root id first', () => {
    const ids = getDescendantFolderIds(tree, 'reapps');
    expect(ids[0]).toBe('reapps');
    expect(ids).toContain('arch');
    expect(ids).toContain('devsub');
    expect(ids).toContain('guide');
    expect(ids).toHaveLength(4);
  });
});

describe('existing helpers still work', () => {
  it('flattenFolderTree collects every folder', () => {
    expect(flattenFolderTree(tree)).toHaveLength(9);
  });

  it('flattenFoldersWithDepth preserves depth', () => {
    const flat = flattenFoldersWithDepth(tree);
    const guide = flat.find((f) => f.id === 'guide');
    expect(guide?.depth).toBe(3);
  });

  it('getAncestorIds returns parent→root order', () => {
    expect(getAncestorIds('guide', tree)).toEqual(['devsub', 'reapps', 'dev']);
  });
});
