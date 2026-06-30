import { describe, it, expect } from 'vitest';
import { parseQuery, evaluate, emptySearchContext, type SearchEntity } from '@reborn/utils';
import { combineAnd } from './search-compose';

function entity(overrides: Partial<SearchEntity>): SearchEntity {
  return {
    id: 'n1',
    title: '',
    tagIds: [],
    folderId: null,
    listId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    dueAt: null,
    flags: {},
    ...overrides
  };
}

describe('combineAnd (structure)', () => {
  it('returns the refine AST unchanged when base is empty', () => {
    const refine = parseQuery('budget');
    expect(combineAnd(parseQuery(''), refine)).toBe(refine);
  });

  it('returns the base AST unchanged when refine is empty', () => {
    const base = parseQuery('no:folder');
    expect(combineAnd(base, parseQuery(''))).toBe(base);
  });

  it('yields a match-all (null root) AST when both are empty', () => {
    expect(combineAnd(parseQuery(''), parseQuery('')).root).toBeNull();
  });

  it('wraps both roots in a single n-ary AND node', () => {
    const base = parseQuery('no:folder');
    const refine = parseQuery('budget');
    const combined = combineAnd(base, refine);
    expect(combined.root?.kind).toBe('and');
    if (combined.root?.kind !== 'and') throw new Error('expected and node');
    expect(combined.root.children).toEqual([base.root, refine.root]);
  });
});

describe('combineAnd (semantics): smart folder membership + sub-filter', () => {
  const ctx = emptySearchContext(new Date('2026-06-30'));

  it('matches an unfiled note whose title contains the refine term', () => {
    const ast = combineAnd(parseQuery('no:folder'), parseQuery('budget'));
    expect(evaluate(ast, entity({ title: 'Q3 budget', folderId: null }), ctx)).toBe(true);
  });

  it('rejects a filed note even when the refine term matches the title', () => {
    const ast = combineAnd(parseQuery('no:folder'), parseQuery('budget'));
    expect(evaluate(ast, entity({ title: 'Q3 budget', folderId: 'f1' }), ctx)).toBe(false);
  });

  it('rejects an unfiled note whose title does not contain the refine term', () => {
    const ast = combineAnd(parseQuery('no:folder'), parseQuery('budget'));
    expect(evaluate(ast, entity({ title: 'groceries', folderId: null }), ctx)).toBe(false);
  });

  it('base-only (empty sub-filter) matches by membership, ignoring the title', () => {
    const ast = combineAnd(parseQuery('no:folder'), parseQuery(''));
    expect(evaluate(ast, entity({ title: 'anything', folderId: null }), ctx)).toBe(true);
    expect(evaluate(ast, entity({ title: 'anything', folderId: 'f1' }), ctx)).toBe(false);
  });
});
