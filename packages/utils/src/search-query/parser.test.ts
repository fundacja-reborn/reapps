import { describe, expect, it } from 'vitest';
import type { Node } from './ast';
import { parseQuery } from './parser';

// Shorthand builders so tests read like the AST they describe.
const text = (value: string, negated = false): Node =>
  ({ kind: 'leaf-text', value, negated } as Node);
const tag = (value: string, negated = false): Node => ({
  kind: 'leaf-filter',
  filter: { kind: 'tag', value, negated }
});
const folder = (value: string, negated = false): Node => ({
  kind: 'leaf-filter',
  filter: { kind: 'folder', value, negated }
});
const list = (value: string, negated = false): Node => ({
  kind: 'leaf-filter',
  filter: { kind: 'list', value, negated }
});
const has = (value: 'link', negated = false): Node => ({
  kind: 'leaf-filter',
  filter: { kind: 'has', value, negated }
});
const is = (
  value: 'starred' | 'pinned' | 'completed' | 'overdue' | 'trashed',
  negated = false
): Node => ({ kind: 'leaf-filter', filter: { kind: 'is', value, negated } });
const and = (...children: Node[]): Node => ({ kind: 'and', children });
const or = (...children: Node[]): Node => ({ kind: 'or', children });
const not = (child: Node): Node => ({ kind: 'not', child });

describe('parseQuery — empty and freetext', () => {
  it('returns empty AST for empty input', () => {
    expect(parseQuery('')).toEqual({ root: null });
    expect(parseQuery('   ')).toEqual({ root: null });
  });

  it('lowercases and ANDs plain freetext words', () => {
    expect(parseQuery('Hello World')).toEqual({
      root: and(text('hello'), text('world'))
    });
  });

  it('preserves quoted whitespace as a single phrase', () => {
    expect(parseQuery('"hello world" foo')).toEqual({
      root: and(text('hello world'), text('foo'))
    });
  });

  it('unwraps a single word into a bare leaf', () => {
    expect(parseQuery('hello')).toEqual({ root: text('hello') });
  });
});

describe('parseQuery — operators', () => {
  it('parses tag operator', () => {
    expect(parseQuery('tag:work')).toEqual({ root: tag('work') });
  });

  it('parses negated tag', () => {
    expect(parseQuery('-tag:archived')).toEqual({ root: tag('archived', true) });
  });

  it('lowercases tag values', () => {
    expect(parseQuery('tag:WORK')).toEqual({ root: tag('work') });
  });

  it('parses folder path normalized', () => {
    expect(parseQuery('folder:Projects/Active')).toEqual({
      root: folder('projects/active')
    });
  });

  it('strips empty segments and trailing slashes in folder', () => {
    expect(parseQuery('folder:/projects//active/')).toEqual({
      root: folder('projects/active')
    });
  });

  it('parses list operator', () => {
    expect(parseQuery('list:Inbox')).toEqual({ root: list('inbox') });
  });

  it('parses date operators', () => {
    const ast = parseQuery('created:>2026-01-01 modified:<7d due:today');
    expect(ast.root?.kind).toBe('and');
    if (ast.root?.kind !== 'and') throw new Error('expected and');
    expect(ast.root.children).toHaveLength(3);
    const [a, b, c] = ast.root.children;
    expect(a.kind === 'leaf-filter' && a.filter.kind === 'date' && a.filter.field).toBe('created');
    expect(b.kind === 'leaf-filter' && b.filter.kind === 'date' && b.filter.field).toBe('modified');
    expect(c.kind === 'leaf-filter' && c.filter.kind === 'date' && c.filter.field).toBe('due');
  });

  it('parses has:link', () => {
    expect(parseQuery('has:link')).toEqual({ root: has('link') });
  });

  it('parses is: flags', () => {
    const ast = parseQuery('is:starred is:pinned is:completed is:overdue is:trashed');
    expect(ast).toEqual({
      root: and(is('starred'), is('pinned'), is('completed'), is('overdue'), is('trashed'))
    });
  });

  it('combines operators with freetext (implicit AND)', () => {
    expect(parseQuery('tag:work meeting notes -is:trashed')).toEqual({
      root: and(tag('work'), text('meeting'), text('notes'), is('trashed', true))
    });
  });
});

describe('parseQuery — quoted operator values', () => {
  it('allows whitespace inside quoted operator value', () => {
    expect(parseQuery('tag:"work in progress"')).toEqual({
      root: tag('work in progress')
    });
  });

  it('treats fully quoted token as a freetext phrase, not as operator', () => {
    expect(parseQuery('"tag:work"')).toEqual({ root: text('tag:work') });
  });
});

describe('parseQuery — Tier 1.5 freetext negation', () => {
  it('plain dashed token becomes an exclude', () => {
    expect(parseQuery('-broken')).toEqual({ root: text('broken', true) });
  });

  it('mixes include words and excludes', () => {
    expect(parseQuery('cat dog -mouse')).toEqual({
      root: and(text('cat'), text('dog'), text('mouse', true))
    });
  });

  it('exclude works with quoted phrase', () => {
    expect(parseQuery('cat -"angry mouse"')).toEqual({
      root: and(text('cat'), text('angry mouse', true))
    });
  });

  it('combines freetext exclude with operator filters', () => {
    expect(parseQuery('meeting tag:work -draft')).toEqual({
      root: and(text('meeting'), tag('work'), text('draft', true))
    });
  });

  it('lone dash stays as a freetext include leaf', () => {
    expect(parseQuery('-')).toEqual({ root: text('-') });
  });

  it('only the leading dash is a negator — extra dashes stay literal', () => {
    expect(parseQuery('--foo')).toEqual({ root: text('-foo', true) });
  });

  it('hyphenated word in the middle of a token stays as one substring', () => {
    expect(parseQuery('multi-word-thing')).toEqual({ root: text('multi-word-thing') });
  });

  it('lowercases excludes', () => {
    expect(parseQuery('-FOO')).toEqual({ root: text('foo', true) });
  });
});

describe('parseQuery — graceful degradation (Tier 1)', () => {
  it('treats unknown operator as freetext', () => {
    expect(parseQuery('foo:bar baz')).toEqual({
      root: and(text('foo:bar'), text('baz'))
    });
  });

  it('treats malformed date as freetext', () => {
    expect(parseQuery('created:tomorrow')).toEqual({
      root: text('created:tomorrow')
    });
  });

  it('treats unknown is: flag as freetext', () => {
    expect(parseQuery('is:fancy')).toEqual({ root: text('is:fancy') });
  });

  it('treats unknown has: value as freetext', () => {
    expect(parseQuery('has:image')).toEqual({ root: text('has:image') });
  });

  it('treats empty operator value as freetext', () => {
    expect(parseQuery('tag:')).toEqual({ root: text('tag:') });
  });

  it('treats colon-only token as freetext', () => {
    expect(parseQuery(':foo')).toEqual({ root: text(':foo') });
  });

  it('a `-key:value` with unknown key degrades into a freetext exclude', () => {
    expect(parseQuery('-foo:bar')).toEqual({ root: text('foo:bar', true) });
  });
});

describe('parseQuery — Tier 2 boolean OR', () => {
  it('parses uppercase OR between two leaves', () => {
    expect(parseQuery('cat OR mouse')).toEqual({
      root: or(text('cat'), text('mouse'))
    });
  });

  it('lowercase `or` is treated as a plain word', () => {
    expect(parseQuery('cat or mouse')).toEqual({
      root: and(text('cat'), text('or'), text('mouse'))
    });
  });

  it('AND binds tighter than OR — `cat dog OR mouse` is `(cat AND dog) OR mouse`', () => {
    expect(parseQuery('cat dog OR mouse')).toEqual({
      root: or(and(text('cat'), text('dog')), text('mouse'))
    });
  });

  it('combines operators across OR', () => {
    expect(parseQuery('tag:work OR tag:personal')).toEqual({
      root: or(tag('work'), tag('personal'))
    });
  });

  it('chains multiple OR operands at the same level', () => {
    expect(parseQuery('cat OR dog OR mouse')).toEqual({
      root: or(text('cat'), text('dog'), text('mouse'))
    });
  });

  it('quoted OR is a literal word, not the operator (lowercased like all freetext)', () => {
    // Quoted segments preserve whitespace and disable structural tokenization,
    // but per Tier 1.5 freetext is always lowercased for case-insensitive
    // matching — so `"OR"` becomes the leaf-text `or`. The point of this case
    // is that `OR` does NOT promote to the boolean operator.
    expect(parseQuery('"OR"')).toEqual({ root: text('or') });
  });

  it('OR inside a value (key:OR) stays in the value', () => {
    expect(parseQuery('tag:OR')).toEqual({ root: tag('or') });
  });
});

describe('parseQuery — Tier 2 grouping', () => {
  it('parses simple parenthesized group', () => {
    expect(parseQuery('(cat dog) OR chicken')).toEqual({
      root: or(and(text('cat'), text('dog')), text('chicken'))
    });
  });

  it('mixes operator with grouped OR', () => {
    expect(parseQuery('tag:work (is:starred OR modified:<7d)')).toMatchObject({
      root: { kind: 'and' }
    });
    const ast = parseQuery('tag:work (is:starred OR modified:<7d)');
    if (ast.root?.kind !== 'and') throw new Error('expected and');
    expect(ast.root.children[0]).toEqual(tag('work'));
    expect(ast.root.children[1].kind).toBe('or');
  });

  it('flattens redundant parens around a single leaf', () => {
    expect(parseQuery('((cat))')).toEqual({ root: text('cat') });
  });

  it('empty group `()` is dropped (TRUE) — only-empty-group becomes empty AST', () => {
    // `()` → TRUE sentinel `{ kind: 'and', children: [] }` at root.
    // Practically equivalent to empty input from the evaluator's perspective.
    expect(parseQuery('()')).toEqual({ root: and() });
  });

  it('empty group inside an AND drops out of the parent', () => {
    // `() cat` → AND(TRUE, cat). The lite-AST builder simplifies this; for
    // the parser we just preserve the structure.
    const ast = parseQuery('() cat');
    if (ast.root?.kind !== 'and') throw new Error('expected and');
    expect(ast.root.children).toHaveLength(2);
    expect(ast.root.children[1]).toEqual(text('cat'));
  });

  it('parses negated group', () => {
    expect(parseQuery('-(tag:archived OR is:trashed)')).toEqual({
      root: not(or(tag('archived'), is('trashed')))
    });
  });

  it('quoted parens are literal characters in the phrase', () => {
    expect(parseQuery('"(test)"')).toEqual({ root: text('(test)') });
  });
});

describe('parseQuery — Tier 2 graceful fallback', () => {
  it('unmatched opening paren falls back to flat parse', () => {
    // `(cat OR` — unmatched `(`, dangling `OR`. Flat: tokens become
    // `(`, `cat`, `OR` (literals).
    expect(parseQuery('(cat OR')).toEqual({
      root: and(text('('), text('cat'), text('or'))
    });
  });

  it('trailing OR falls back to flat parse', () => {
    expect(parseQuery('cat OR')).toEqual({
      root: and(text('cat'), text('or'))
    });
  });

  it('leading OR falls back to flat parse', () => {
    expect(parseQuery('OR cat')).toEqual({
      root: and(text('or'), text('cat'))
    });
  });

  it('unmatched closing paren falls back to flat parse', () => {
    expect(parseQuery('cat) dog')).toEqual({
      root: and(text('cat'), text(')'), text('dog'))
    });
  });

  it('negated unmatched group falls back to flat parse', () => {
    // `-(tag:work` — `-` followed by `(` would start Not(group), but the
    // group never closes → ParseError → flat fallback. Tokens are
    // WORD `-`, LPAREN, WORD `tag:work`. In flat fallback the bare `-`
    // becomes a literal leaf, the `(` becomes the literal char `(`, and
    // `tag:work` resolves through parseAtom into a tag filter.
    expect(parseQuery('-(tag:work')).toEqual({
      root: and(text('-'), text('('), tag('work'))
    });
  });
});

describe('parseQuery — multiple filters (regression)', () => {
  it('parses a complex Tier 1 query', () => {
    const ast = parseQuery(
      'tag:reading -tag:archived folder:inbox created:>2026-01-01 has:link foo bar'
    );
    expect(ast.root?.kind).toBe('and');
    if (ast.root?.kind !== 'and') throw new Error('expected and');
    expect(ast.root.children).toHaveLength(7);
    expect(ast.root.children[0]).toEqual(tag('reading'));
    expect(ast.root.children[1]).toEqual(tag('archived', true));
    expect(ast.root.children[2]).toEqual(folder('inbox'));
    // [3] is the date filter — checked by kind below.
    const dateNode = ast.root.children[3];
    expect(dateNode.kind === 'leaf-filter' && dateNode.filter.kind === 'date').toBe(true);
    expect(ast.root.children[4]).toEqual(has('link'));
    expect(ast.root.children[5]).toEqual(text('foo'));
    expect(ast.root.children[6]).toEqual(text('bar'));
  });
});
