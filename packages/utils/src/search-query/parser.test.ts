import { describe, expect, it } from 'vitest';
import { parseQuery } from './parser';

const EMPTY_FT = { include: [], exclude: [] };

describe('parseQuery — empty and freetext', () => {
  it('returns empty AST for empty input', () => {
    expect(parseQuery('')).toEqual({ freetext: EMPTY_FT, filters: [] });
    expect(parseQuery('   ')).toEqual({ freetext: EMPTY_FT, filters: [] });
  });

  it('lowercases and splits plain freetext into AND-words', () => {
    expect(parseQuery('Hello World')).toEqual({
      freetext: { include: ['hello', 'world'], exclude: [] },
      filters: []
    });
  });

  it('preserves quoted whitespace as a single phrase', () => {
    expect(parseQuery('"hello world" foo')).toEqual({
      freetext: { include: ['hello world', 'foo'], exclude: [] },
      filters: []
    });
  });
});

describe('parseQuery — operators', () => {
  it('parses tag operator', () => {
    const ast = parseQuery('tag:work');
    expect(ast.filters).toEqual([{ kind: 'tag', value: 'work', negated: false }]);
    expect(ast.freetext).toEqual(EMPTY_FT);
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
    expect(ast.freetext).toEqual({ include: ['meeting', 'notes'], exclude: [] });
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

  it('treats fully quoted token as a freetext phrase, not as operator', () => {
    const ast = parseQuery('"tag:work"');
    expect(ast.freetext).toEqual({ include: ['tag:work'], exclude: [] });
    expect(ast.filters).toEqual([]);
  });
});

describe('parseQuery — Tier 1.5 freetext negation', () => {
  it('plain dashed token becomes an exclude', () => {
    expect(parseQuery('-broken')).toEqual({
      freetext: { include: [], exclude: ['broken'] },
      filters: []
    });
  });

  it('mixes include words and excludes', () => {
    expect(parseQuery('cat dog -mouse')).toEqual({
      freetext: { include: ['cat', 'dog'], exclude: ['mouse'] },
      filters: []
    });
  });

  it('exclude works with quoted phrase', () => {
    expect(parseQuery('cat -"angry mouse"')).toEqual({
      freetext: { include: ['cat'], exclude: ['angry mouse'] },
      filters: []
    });
  });

  it('combines freetext exclude with operator filters', () => {
    const ast = parseQuery('meeting tag:work -draft');
    expect(ast.freetext).toEqual({ include: ['meeting'], exclude: ['draft'] });
    expect(ast.filters).toEqual([{ kind: 'tag', value: 'work', negated: false }]);
  });

  it('lone dash stays as a freetext include item', () => {
    expect(parseQuery('-')).toEqual({
      freetext: { include: ['-'], exclude: [] },
      filters: []
    });
  });

  it('only the leading dash is a negator — extra dashes stay literal', () => {
    expect(parseQuery('--foo')).toEqual({
      freetext: { include: [], exclude: ['-foo'] },
      filters: []
    });
  });

  it('hyphenated word in the middle of a token stays as one substring', () => {
    expect(parseQuery('multi-word-thing')).toEqual({
      freetext: { include: ['multi-word-thing'], exclude: [] },
      filters: []
    });
  });

  it('lowercases excludes', () => {
    expect(parseQuery('-FOO')).toEqual({
      freetext: { include: [], exclude: ['foo'] },
      filters: []
    });
  });
});

describe('parseQuery — graceful degradation', () => {
  it('treats unknown operator as freetext', () => {
    const ast = parseQuery('foo:bar baz');
    expect(ast.freetext).toEqual({ include: ['foo:bar', 'baz'], exclude: [] });
    expect(ast.filters).toEqual([]);
  });

  it('treats malformed date as freetext', () => {
    const ast = parseQuery('created:tomorrow');
    expect(ast.freetext).toEqual({ include: ['created:tomorrow'], exclude: [] });
    expect(ast.filters).toEqual([]);
  });

  it('treats unknown is: flag as freetext', () => {
    const ast = parseQuery('is:fancy');
    expect(ast.freetext).toEqual({ include: ['is:fancy'], exclude: [] });
    expect(ast.filters).toEqual([]);
  });

  it('treats unknown has: value as freetext', () => {
    const ast = parseQuery('has:image');
    expect(ast.freetext).toEqual({ include: ['has:image'], exclude: [] });
    expect(ast.filters).toEqual([]);
  });

  it('treats empty operator value as freetext', () => {
    const ast = parseQuery('tag:');
    expect(ast.freetext).toEqual({ include: ['tag:'], exclude: [] });
    expect(ast.filters).toEqual([]);
  });

  it('treats colon-only token as freetext', () => {
    const ast = parseQuery(':foo');
    expect(ast.freetext).toEqual({ include: [':foo'], exclude: [] });
    expect(ast.filters).toEqual([]);
  });

  it('a `-key:value` with unknown key degrades into a freetext exclude', () => {
    // The dash is a meaningful negator (Tier 1.5) when the body is not an
    // operator — `-foo:bar` excludes the substring `foo:bar`.
    const ast = parseQuery('-foo:bar');
    expect(ast.freetext).toEqual({ include: [], exclude: ['foo:bar'] });
    expect(ast.filters).toEqual([]);
  });
});

describe('parseQuery — multiple filters', () => {
  it('parses a complex query', () => {
    const ast = parseQuery(
      'tag:reading -tag:archived folder:inbox created:>2026-01-01 has:link foo bar'
    );
    expect(ast.freetext).toEqual({ include: ['foo', 'bar'], exclude: [] });
    expect(ast.filters).toHaveLength(5);
    expect(ast.filters[0]).toMatchObject({ kind: 'tag', value: 'reading', negated: false });
    expect(ast.filters[1]).toMatchObject({ kind: 'tag', value: 'archived', negated: true });
    expect(ast.filters[2]).toMatchObject({ kind: 'folder', value: 'inbox' });
    expect(ast.filters[3]).toMatchObject({ kind: 'date', field: 'created' });
    expect(ast.filters[4]).toMatchObject({ kind: 'has', value: 'link' });
  });
});
