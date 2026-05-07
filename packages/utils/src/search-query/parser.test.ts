import { describe, expect, it } from 'vitest';
import { parseQuery } from './parser';

describe('parseQuery — empty and freetext', () => {
  it('returns empty AST for empty input', () => {
    expect(parseQuery('')).toEqual({ freetext: '', filters: [] });
    expect(parseQuery('   ')).toEqual({ freetext: '', filters: [] });
  });

  it('lowercases and joins plain freetext', () => {
    expect(parseQuery('Hello World')).toEqual({
      freetext: 'hello world',
      filters: []
    });
  });

  it('preserves quoted whitespace in freetext', () => {
    expect(parseQuery('"hello world" foo')).toEqual({
      freetext: 'hello world foo',
      filters: []
    });
  });
});

describe('parseQuery — operators', () => {
  it('parses tag operator', () => {
    const ast = parseQuery('tag:work');
    expect(ast.filters).toEqual([{ kind: 'tag', value: 'work', negated: false }]);
    expect(ast.freetext).toBe('');
  });

  it('parses negated tag', () => {
    const ast = parseQuery('-tag:archived');
    expect(ast.filters).toEqual([
      { kind: 'tag', value: 'archived', negated: true }
    ]);
  });

  it('lowercases tag values', () => {
    expect(parseQuery('tag:WORK').filters).toEqual([
      { kind: 'tag', value: 'work', negated: false }
    ]);
  });

  it('parses folder path normalized', () => {
    expect(parseQuery('folder:Projects/Active').filters).toEqual([
      { kind: 'folder', value: 'projects/active', negated: false }
    ]);
  });

  it('strips empty segments and trailing slashes in folder', () => {
    expect(parseQuery('folder:/projects//active/').filters).toEqual([
      { kind: 'folder', value: 'projects/active', negated: false }
    ]);
  });

  it('parses list operator', () => {
    expect(parseQuery('list:Inbox').filters).toEqual([
      { kind: 'list', value: 'inbox', negated: false }
    ]);
  });

  it('parses date operators', () => {
    const ast = parseQuery('created:>2026-01-01 modified:<7d due:today');
    expect(ast.filters).toHaveLength(3);
    expect(ast.filters[0]).toMatchObject({
      kind: 'date',
      field: 'created',
      negated: false
    });
    expect(ast.filters[1]).toMatchObject({ kind: 'date', field: 'modified' });
    expect(ast.filters[2]).toMatchObject({ kind: 'date', field: 'due' });
  });

  it('parses has:link', () => {
    expect(parseQuery('has:link').filters).toEqual([
      { kind: 'has', value: 'link', negated: false }
    ]);
  });

  it('parses is: flags', () => {
    const ast = parseQuery('is:starred is:pinned is:completed is:overdue is:trashed');
    expect(ast.filters.map((f) => (f.kind === 'is' ? f.value : null))).toEqual([
      'starred',
      'pinned',
      'completed',
      'overdue',
      'trashed'
    ]);
  });

  it('combines operators with freetext', () => {
    const ast = parseQuery('tag:work meeting notes -is:trashed');
    expect(ast.freetext).toBe('meeting notes');
    expect(ast.filters).toEqual([
      { kind: 'tag', value: 'work', negated: false },
      { kind: 'is', value: 'trashed', negated: true }
    ]);
  });
});

describe('parseQuery — quoted operator values', () => {
  it('allows whitespace inside quoted operator value', () => {
    expect(parseQuery('tag:"work in progress"').filters).toEqual([
      { kind: 'tag', value: 'work in progress', negated: false }
    ]);
  });

  it('treats fully quoted token as freetext', () => {
    const ast = parseQuery('"tag:work"');
    expect(ast.freetext).toBe('tag:work');
    expect(ast.filters).toEqual([]);
  });
});

describe('parseQuery — graceful degradation', () => {
  it('treats unknown operator as freetext', () => {
    const ast = parseQuery('foo:bar baz');
    expect(ast.freetext).toBe('foo:bar baz');
    expect(ast.filters).toEqual([]);
  });

  it('treats malformed date as freetext', () => {
    const ast = parseQuery('created:tomorrow');
    expect(ast.freetext).toBe('created:tomorrow');
    expect(ast.filters).toEqual([]);
  });

  it('treats unknown is: flag as freetext', () => {
    const ast = parseQuery('is:fancy');
    expect(ast.freetext).toBe('is:fancy');
    expect(ast.filters).toEqual([]);
  });

  it('treats unknown has: value as freetext', () => {
    const ast = parseQuery('has:image');
    expect(ast.freetext).toBe('has:image');
    expect(ast.filters).toEqual([]);
  });

  it('treats empty operator value as freetext', () => {
    const ast = parseQuery('tag:');
    expect(ast.freetext).toBe('tag:');
    expect(ast.filters).toEqual([]);
  });

  it('treats colon-only token as freetext', () => {
    const ast = parseQuery(':foo');
    expect(ast.freetext).toBe(':foo');
    expect(ast.filters).toEqual([]);
  });

  it('keeps the dash when degraded freetext was negated', () => {
    const ast = parseQuery('-foo:bar');
    expect(ast.freetext).toBe('-foo:bar');
    expect(ast.filters).toEqual([]);
  });

  it('plain dashed token stays as freetext (no Tier 1 freetext negation)', () => {
    const ast = parseQuery('-broken');
    expect(ast.freetext).toBe('-broken');
    expect(ast.filters).toEqual([]);
  });
});

describe('parseQuery — multiple filters', () => {
  it('parses a complex query', () => {
    const ast = parseQuery(
      'tag:reading -tag:archived folder:inbox created:>2026-01-01 has:link foo bar'
    );
    expect(ast.freetext).toBe('foo bar');
    expect(ast.filters).toHaveLength(5);
    expect(ast.filters[0]).toMatchObject({ kind: 'tag', value: 'reading', negated: false });
    expect(ast.filters[1]).toMatchObject({ kind: 'tag', value: 'archived', negated: true });
    expect(ast.filters[2]).toMatchObject({ kind: 'folder', value: 'inbox' });
    expect(ast.filters[3]).toMatchObject({ kind: 'date', field: 'created' });
    expect(ast.filters[4]).toMatchObject({ kind: 'has', value: 'link' });
  });
});
