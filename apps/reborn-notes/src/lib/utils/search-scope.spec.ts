import { describe, it, expect } from 'vitest';
import { composeScopedQuery, scopeOperatorPrefix, type SaveScope } from './search-scope';

describe('scopeOperatorPrefix', () => {
  it('quotes folder paths (spaces and nesting safe)', () => {
    const scope: SaveScope = {
      kind: 'folder',
      folderId: 'f1',
      folderName: 'Active',
      path: 'Side Projects/Active'
    };
    expect(scopeOperatorPrefix(scope)).toBe('folder:"Side Projects/Active"');
  });

  it('quotes tag names', () => {
    expect(scopeOperatorPrefix({ kind: 'tag', name: 'in progress' })).toBe('tag:"in progress"');
  });

  it('maps starred to is:starred and null to empty', () => {
    expect(scopeOperatorPrefix({ kind: 'starred' })).toBe('is:starred');
    expect(scopeOperatorPrefix(null)).toBe('');
  });
});

describe('composeScopedQuery', () => {
  const folder: SaveScope = {
    kind: 'folder',
    folderId: 'f1',
    folderName: 'Projects',
    path: 'Projects'
  };

  it('prepends the scope operator to the typed query', () => {
    expect(composeScopedQuery(folder, ' test ')).toBe('folder:"Projects" test');
  });

  it('returns the bare query when there is no scope (global views)', () => {
    expect(composeScopedQuery(null, ' test ')).toBe('test');
  });

  it('returns just the operator when the query is empty', () => {
    expect(composeScopedQuery(folder, '   ')).toBe('folder:"Projects"');
  });
});
