import { describe, expect, it } from 'vitest';
import { isEmpty, requiresContent } from './ast';
import {
  emptySearchContext,
  evaluate,
  type SearchContext,
  type SearchEntity
} from './evaluator';
import { parseQuery } from './parser';

const NOW = new Date(2026, 4, 6, 12, 0, 0); // 2026-05-06 noon local

function makeEntity(overrides: Partial<SearchEntity> = {}): SearchEntity {
  return {
    id: 'e1',
    title: 'Untitled',
    body: undefined,
    tagIds: [],
    folderId: null,
    listId: null,
    createdAt: new Date(2026, 4, 1, 10, 0, 0),
    updatedAt: new Date(2026, 4, 5, 10, 0, 0),
    dueAt: null,
    flags: {},
    ...overrides
  };
}

function makeCtx(overrides: Partial<SearchContext> = {}): SearchContext {
  return {
    ...emptySearchContext(NOW),
    ...overrides
  };
}

describe('evaluate — freetext', () => {
  it('matches title substring', () => {
    const ast = parseQuery('hello');
    const entity = makeEntity({ title: 'Hello world' });
    expect(evaluate(ast, entity, makeCtx())).toBe(true);
  });

  it('AND-combines multiple words', () => {
    const ast = parseQuery('hello world');
    expect(
      evaluate(ast, makeEntity({ title: 'Hello there world' }), makeCtx())
    ).toBe(true);
    expect(
      evaluate(ast, makeEntity({ title: 'Hello there' }), makeCtx())
    ).toBe(false);
  });

  it('matches body when provided', () => {
    const ast = parseQuery('important');
    expect(
      evaluate(ast, makeEntity({ title: 'foo', body: 'this is important' }), makeCtx())
    ).toBe(true);
  });

  it('does not match body when body is undefined', () => {
    const ast = parseQuery('important');
    expect(evaluate(ast, makeEntity({ title: 'foo' }), makeCtx())).toBe(false);
  });

  it('empty freetext matches anything (when no filters)', () => {
    expect(evaluate(parseQuery(''), makeEntity(), makeCtx())).toBe(true);
  });
});

describe('evaluate — Tier 1.5 freetext phrases and excludes', () => {
  it('quoted phrase requires the literal substring including whitespace', () => {
    const ast = parseQuery('"meeting prep"');
    expect(
      evaluate(ast, makeEntity({ title: 'Q3 meeting prep agenda' }), makeCtx())
    ).toBe(true);
    expect(
      evaluate(ast, makeEntity({ title: 'meeting agenda — prep notes' }), makeCtx())
    ).toBe(false);
  });

  it('plain `-word` excludes entities containing word', () => {
    const ast = parseQuery('cat -mouse');
    expect(evaluate(ast, makeEntity({ title: 'a fat cat' }), makeCtx())).toBe(true);
    expect(
      evaluate(ast, makeEntity({ title: 'cat and mouse' }), makeCtx())
    ).toBe(false);
  });

  it('exclude phrase ignores its substring even if individual words match', () => {
    const ast = parseQuery('cat -"angry mouse"');
    expect(evaluate(ast, makeEntity({ title: 'cat with angry mouse' }), makeCtx())).toBe(false);
    expect(
      evaluate(ast, makeEntity({ title: 'cat with angry dog and mouse' }), makeCtx())
    ).toBe(true);
  });

  it('exclude also looks at body when populated', () => {
    const ast = parseQuery('-secret');
    expect(
      evaluate(ast, makeEntity({ title: 'public', body: 'this is secret' }), makeCtx())
    ).toBe(false);
    expect(
      evaluate(ast, makeEntity({ title: 'public', body: 'nothing here' }), makeCtx())
    ).toBe(true);
  });

  it('only-exclude query (no include) matches everything except hits', () => {
    const ast = parseQuery('-spam');
    expect(evaluate(ast, makeEntity({ title: 'inbox' }), makeCtx())).toBe(true);
    expect(evaluate(ast, makeEntity({ title: 'spam folder' }), makeCtx())).toBe(false);
  });

  it('include and exclude combine with operator filters (all AND)', () => {
    const ctx = makeCtx({ tagIdByName: new Map([['work', 'tag-w']]) });
    const ast = parseQuery('tag:work meeting -draft');
    expect(
      evaluate(
        ast,
        makeEntity({ tagIds: ['tag-w'], title: 'meeting agenda' }),
        ctx
      )
    ).toBe(true);
    expect(
      evaluate(
        ast,
        makeEntity({ tagIds: ['tag-w'], title: 'meeting draft v2' }),
        ctx
      )
    ).toBe(false);
    expect(
      evaluate(
        ast,
        makeEntity({ tagIds: ['tag-w'], title: 'lunch' }),
        ctx
      )
    ).toBe(false);
  });
});

describe('evaluate — tag filter', () => {
  it('matches when tag id resolves and entity has it', () => {
    const ctx = makeCtx({ tagIdByName: new Map([['work', 'tag-1']]) });
    expect(
      evaluate(parseQuery('tag:work'), makeEntity({ tagIds: ['tag-1'] }), ctx)
    ).toBe(true);
  });

  it('returns false when tag does not resolve', () => {
    const ctx = makeCtx();
    expect(
      evaluate(parseQuery('tag:unknown'), makeEntity({ tagIds: ['tag-1'] }), ctx)
    ).toBe(false);
  });

  it('negation flips no-match into match-all', () => {
    const ctx = makeCtx();
    expect(
      evaluate(parseQuery('-tag:nonexistent'), makeEntity(), ctx)
    ).toBe(true);
  });

  it('negation excludes entities that have the tag', () => {
    const ctx = makeCtx({ tagIdByName: new Map([['archived', 'tag-x']]) });
    expect(
      evaluate(
        parseQuery('-tag:archived'),
        makeEntity({ tagIds: ['tag-x'] }),
        ctx
      )
    ).toBe(false);
    expect(
      evaluate(parseQuery('-tag:archived'), makeEntity({ tagIds: [] }), ctx)
    ).toBe(true);
  });
});

describe('evaluate — folder and list filters', () => {
  it('folder matches exact path', () => {
    const ctx = makeCtx({
      folderIdByPath: new Map([['projects/active', 'f-1']])
    });
    expect(
      evaluate(
        parseQuery('folder:projects/active'),
        makeEntity({ folderId: 'f-1' }),
        ctx
      )
    ).toBe(true);
  });

  it('folder does not match parent path (no subtree match in Tier 1)', () => {
    const ctx = makeCtx({
      folderIdByPath: new Map([['projects/active', 'f-active']])
    });
    expect(
      evaluate(
        parseQuery('folder:projects'),
        makeEntity({ folderId: 'f-active' }),
        ctx
      )
    ).toBe(false);
  });

  it('list matches by resolved id', () => {
    const ctx = makeCtx({ listIdByName: new Map([['inbox', 'list-1']]) });
    expect(
      evaluate(parseQuery('list:Inbox'), makeEntity({ listId: 'list-1' }), ctx)
    ).toBe(true);
  });
});

describe('evaluate — date filters', () => {
  it('created:>YYYY-MM-DD matches newer entities', () => {
    const ast = parseQuery('created:>2026-04-01');
    expect(
      evaluate(ast, makeEntity({ createdAt: new Date(2026, 4, 1) }), makeCtx())
    ).toBe(true);
    expect(
      evaluate(ast, makeEntity({ createdAt: new Date(2026, 2, 15) }), makeCtx())
    ).toBe(false);
  });

  it('created:<YYYY-MM-DD matches older entities', () => {
    const ast = parseQuery('created:<2026-04-01');
    expect(
      evaluate(ast, makeEntity({ createdAt: new Date(2026, 2, 15) }), makeCtx())
    ).toBe(true);
    expect(
      evaluate(ast, makeEntity({ createdAt: new Date(2026, 4, 5) }), makeCtx())
    ).toBe(false);
  });

  it('modified:<7d means within last 7 days (recent)', () => {
    const ast = parseQuery('modified:<7d');
    // 2 days ago — recent
    expect(
      evaluate(ast, makeEntity({ updatedAt: new Date(2026, 4, 4) }), makeCtx())
    ).toBe(true);
    // 30 days ago — too old
    expect(
      evaluate(ast, makeEntity({ updatedAt: new Date(2026, 3, 6) }), makeCtx())
    ).toBe(false);
  });

  it('modified:>7d means older than 7 days', () => {
    const ast = parseQuery('modified:>7d');
    expect(
      evaluate(ast, makeEntity({ updatedAt: new Date(2026, 3, 1) }), makeCtx())
    ).toBe(true);
    expect(
      evaluate(ast, makeEntity({ updatedAt: new Date(2026, 4, 5) }), makeCtx())
    ).toBe(false);
  });

  it('range matches inclusive on both ends', () => {
    const ast = parseQuery('created:2026-01-01..2026-02-01');
    expect(
      evaluate(ast, makeEntity({ createdAt: new Date(2026, 0, 1) }), makeCtx())
    ).toBe(true);
    expect(
      evaluate(ast, makeEntity({ createdAt: new Date(2026, 1, 1, 23, 59) }), makeCtx())
    ).toBe(true);
    expect(
      evaluate(ast, makeEntity({ createdAt: new Date(2026, 1, 2) }), makeCtx())
    ).toBe(false);
  });

  it('due filter against null due date returns false', () => {
    const ast = parseQuery('due:<7d');
    expect(evaluate(ast, makeEntity({ dueAt: null }), makeCtx())).toBe(false);
  });
});

describe('evaluate — is: flags', () => {
  it('is:starred', () => {
    expect(
      evaluate(
        parseQuery('is:starred'),
        makeEntity({ flags: { starred: true } }),
        makeCtx()
      )
    ).toBe(true);
    expect(
      evaluate(parseQuery('is:starred'), makeEntity({ flags: {} }), makeCtx())
    ).toBe(false);
  });

  it('is:overdue requires due date in past, not completed, not trashed', () => {
    const ast = parseQuery('is:overdue');
    expect(
      evaluate(
        ast,
        makeEntity({ dueAt: new Date(2026, 3, 1), flags: {} }),
        makeCtx()
      )
    ).toBe(true);
    expect(
      evaluate(
        ast,
        makeEntity({
          dueAt: new Date(2026, 3, 1),
          flags: { completed: true }
        }),
        makeCtx()
      )
    ).toBe(false);
    expect(
      evaluate(
        ast,
        makeEntity({ dueAt: new Date(2026, 5, 1), flags: {} }),
        makeCtx()
      )
    ).toBe(false);
    expect(evaluate(ast, makeEntity({ dueAt: null }), makeCtx())).toBe(false);
  });
});

describe('evaluate — has:link', () => {
  it('matches plain http URL in body', () => {
    expect(
      evaluate(
        parseQuery('has:link'),
        makeEntity({ body: 'see https://example.com for details' }),
        makeCtx()
      )
    ).toBe(true);
  });

  it('matches markdown link in body', () => {
    expect(
      evaluate(
        parseQuery('has:link'),
        makeEntity({ body: '[click](here)' }),
        makeCtx()
      )
    ).toBe(true);
  });

  it('returns false when body is undefined', () => {
    expect(evaluate(parseQuery('has:link'), makeEntity(), makeCtx())).toBe(false);
  });

  it('returns false when body has no link', () => {
    expect(
      evaluate(
        parseQuery('has:link'),
        makeEntity({ body: 'just some text' }),
        makeCtx()
      )
    ).toBe(false);
  });
});

describe('evaluate — combinations', () => {
  it('all filters AND-combined', () => {
    const ctx = makeCtx({
      tagIdByName: new Map([['reading', 'tag-r']]),
      folderIdByPath: new Map([['inbox', 'f-i']])
    });
    const ast = parseQuery('tag:reading folder:inbox is:starred');
    const matching = makeEntity({
      tagIds: ['tag-r'],
      folderId: 'f-i',
      flags: { starred: true }
    });
    expect(evaluate(ast, matching, ctx)).toBe(true);

    const missingFolder = makeEntity({
      tagIds: ['tag-r'],
      folderId: 'other',
      flags: { starred: true }
    });
    expect(evaluate(ast, missingFolder, ctx)).toBe(false);
  });

  it('freetext AND operators', () => {
    const ctx = makeCtx({ tagIdByName: new Map([['work', 'tag-w']]) });
    const ast = parseQuery('tag:work meeting');
    expect(
      evaluate(
        ast,
        makeEntity({ tagIds: ['tag-w'], title: 'Team meeting' }),
        ctx
      )
    ).toBe(true);
    expect(
      evaluate(
        ast,
        makeEntity({ tagIds: ['tag-w'], title: 'Lunch' }),
        ctx
      )
    ).toBe(false);
  });
});

describe('AST helpers', () => {
  it('isEmpty detects empty AST', () => {
    expect(isEmpty(parseQuery(''))).toBe(true);
    expect(isEmpty(parseQuery('foo'))).toBe(false);
    expect(isEmpty(parseQuery('tag:work'))).toBe(false);
  });

  it('requiresContent flags has:link', () => {
    expect(requiresContent(parseQuery('foo'))).toBe(false);
    expect(requiresContent(parseQuery('tag:work'))).toBe(false);
    expect(requiresContent(parseQuery('has:link'))).toBe(true);
    expect(requiresContent(parseQuery('tag:work has:link'))).toBe(true);
  });
});
