import { describe, expect, it } from 'vitest';
import type { Node, QueryAST } from './ast';
import { isEmpty } from './ast';
import { emptySearchContext, evaluate, type SearchEntity } from './evaluator';
import { buildLiteAst } from './lite-ast';
import { parseQuery } from './parser';

const tag = (value: string, negated = false): Node => ({
  kind: 'leaf-filter',
  filter: { kind: 'tag', value, negated }
});
const is = (
  value: 'starred' | 'pinned' | 'completed' | 'overdue',
  negated = false
): Node => ({ kind: 'leaf-filter', filter: { kind: 'is', value, negated } });
const and = (...children: Node[]): Node => ({ kind: 'and', children });
const or = (...children: Node[]): Node => ({ kind: 'or', children });
const not = (child: Node): Node => ({ kind: 'not', child });

const TRUE_AST: QueryAST = { root: null };

describe('buildLiteAst — pass-through and trivial cases', () => {
  it('empty AST stays empty', () => {
    expect(buildLiteAst({ root: null })).toEqual(TRUE_AST);
  });

  it('lone leaf-text collapses to empty AST (matches everything)', () => {
    expect(buildLiteAst(parseQuery('cat'))).toEqual(TRUE_AST);
  });

  it('lone has:link collapses to empty AST', () => {
    expect(buildLiteAst(parseQuery('has:link'))).toEqual(TRUE_AST);
  });

  it('lone structural filter passes through verbatim', () => {
    expect(buildLiteAst(parseQuery('tag:work'))).toEqual({ root: tag('work') });
  });
});

describe('buildLiteAst — AND simplification', () => {
  it('drops leaf-text from AND, keeps structural', () => {
    expect(buildLiteAst(parseQuery('cat tag:work'))).toEqual({
      root: tag('work')
    });
  });

  it('drops has:link from AND, keeps structural', () => {
    expect(buildLiteAst(parseQuery('tag:work has:link'))).toEqual({
      root: tag('work')
    });
  });

  it('AND of two structurals stays as AND', () => {
    expect(buildLiteAst(parseQuery('tag:work is:starred'))).toEqual({
      root: and(tag('work'), is('starred'))
    });
  });

  it('AND of all-TRUE collapses to empty AST', () => {
    expect(buildLiteAst(parseQuery('cat dog has:link'))).toEqual(TRUE_AST);
  });
});

describe('buildLiteAst — OR simplification', () => {
  it('OR with TRUE arm collapses entire OR to empty AST', () => {
    // `tag:work OR has:link` → over-match: pre-filter returns full scope,
    // body-aware pass narrows down. This is the documented trade-off.
    expect(buildLiteAst(parseQuery('tag:work OR has:link'))).toEqual(TRUE_AST);
  });

  it('OR with leaf-text arm collapses to TRUE', () => {
    expect(buildLiteAst(parseQuery('tag:work OR cat'))).toEqual(TRUE_AST);
  });

  it('OR of two structurals stays as OR', () => {
    expect(buildLiteAst(parseQuery('tag:work OR is:starred'))).toEqual({
      root: or(tag('work'), is('starred'))
    });
  });

  it('inner OR with body-dep arm under outer AND drops to outer structural', () => {
    expect(buildLiteAst(parseQuery('tag:work (cat OR is:starred)'))).toEqual({
      root: tag('work')
    });
  });
});

describe('buildLiteAst — NOT simplification (polarity-aware)', () => {
  it('NOT(leaf-text) keeps structural AND arm — no under-match', () => {
    // `-(cat) tag:work` should NOT collapse to FALSE. With polarity-aware
    // strip: leaf-text under negative polarity → FALSE → NOT(FALSE) = TRUE
    // → AND(TRUE, tag) → tag:work.
    expect(buildLiteAst(parseQuery('-(cat) tag:work'))).toEqual({
      root: tag('work')
    });
  });

  it('NOT of structural filter passes through', () => {
    expect(buildLiteAst(parseQuery('-(tag:archived)'))).toEqual({
      root: not(tag('archived'))
    });
  });

  it('NOT of OR(structural, leaf-text) keeps structural arm of NOT', () => {
    // `-(tag:archived OR cat)` — under NOT we flip polarity. The 'cat' leaf
    // becomes FALSE, the OR drops it, leaving NOT(tag:archived). The lite
    // pre-filter still excludes archived items, and the body-aware pass
    // applies the full -(… OR cat) check post-decryption.
    expect(buildLiteAst(parseQuery('-(tag:archived OR cat)'))).toEqual({
      root: not(tag('archived'))
    });
  });

  it('Tier 1.5 leaf-level `-cat` AND structural keeps structural', () => {
    // Leaf-level negation on a body-dependent leaf still strips polarity-
    // correctly because the leaf is itself the unit being approximated.
    expect(buildLiteAst(parseQuery('-cat tag:work'))).toEqual({
      root: tag('work')
    });
  });
});

describe('buildLiteAst — soundness contract (lite ⊇ full)', () => {
  // Validate the contract by sampling: for a small entity set and a few
  // queries, every entity that matches the full AST must also match the
  // lite AST. The body-aware pipeline relies on this — a violation means
  // entries that should match get pre-filtered away.

  function makeEntity(overrides: Partial<SearchEntity> = {}): SearchEntity {
    return {
      id: 'e',
      title: '',
      body: undefined,
      tagIds: [],
      folderId: null,
      listId: null,
      createdAt: new Date(2026, 0, 1),
      updatedAt: new Date(2026, 0, 1),
      dueAt: null,
      flags: {},
      ...overrides
    };
  }

  const NOW = new Date(2026, 4, 6, 12, 0, 0);

  function ctxWithTags(tags: Record<string, string>) {
    return {
      ...emptySearchContext(NOW),
      tagIdByName: new Map(Object.entries(tags))
    };
  }

  const ctx = ctxWithTags({ work: 'tag-w', archived: 'tag-a', personal: 'tag-p' });

  // Sample entities covering the relevant axes.
  const entities: SearchEntity[] = [
    makeEntity({ id: 'work-cat', title: 'cat', body: 'cat in body', tagIds: ['tag-w'] }),
    makeEntity({ id: 'work-no-cat', title: 'meeting', body: 'agenda', tagIds: ['tag-w'] }),
    makeEntity({ id: 'archived-cat', title: 'cat', body: '', tagIds: ['tag-a'] }),
    makeEntity({ id: 'starred', title: 'note', body: '', flags: { starred: true } }),
    makeEntity({ id: 'plain', title: 'plain', body: '' }),
    makeEntity({ id: 'personal', title: 'foo', body: '', tagIds: ['tag-p'] }),
    makeEntity({
      id: 'plain-with-link',
      title: 'doc',
      body: 'see https://example.com',
      tagIds: ['tag-w']
    })
  ];

  const queries = [
    '-(cat) tag:work',
    '-(tag:archived OR cat)',
    'tag:work OR cat',
    'tag:work has:link',
    'tag:work OR has:link',
    '-cat tag:work',
    'tag:work AND (is:starred OR is:pinned)',
    '(cat OR dog) tag:work'
  ];

  for (const q of queries) {
    it(`lite ⊇ full for "${q}"`, () => {
      const full = parseQuery(q);
      const lite = buildLiteAst(full);
      for (const e of entities) {
        const fullMatch = evaluate(full, e, ctx);
        const liteMatch = evaluate(lite, e, ctx);
        if (fullMatch && !liteMatch) {
          throw new Error(
            `under-match for query="${q}" entity="${e.id}": full=true, lite=false`
          );
        }
      }
    });
  }

  it('isEmpty correctly detects collapsed lite ASTs', () => {
    expect(isEmpty(buildLiteAst(parseQuery('cat dog')))).toBe(true);
    expect(isEmpty(buildLiteAst(parseQuery('tag:work')))).toBe(false);
  });
});
