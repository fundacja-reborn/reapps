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

  it('folder matches descendants (subtree) when folderPathById is provided', () => {
    // Mirrors the folder view, which searches the folder and all subfolders.
    const ctx = makeCtx({
      folderIdByPath: new Map([
        ['projects', 'f-projects'],
        ['projects/active', 'f-active'],
        ['projects/active/q2', 'f-q2']
      ]),
      folderPathById: new Map([
        ['f-projects', 'projects'],
        ['f-active', 'projects/active'],
        ['f-q2', 'projects/active/q2']
      ])
    });
    const ast = parseQuery('folder:projects');
    expect(evaluate(ast, makeEntity({ folderId: 'f-projects' }), ctx)).toBe(true);
    expect(evaluate(ast, makeEntity({ folderId: 'f-active' }), ctx)).toBe(true);
    expect(evaluate(ast, makeEntity({ folderId: 'f-q2' }), ctx)).toBe(true);
  });

  it('subtree match respects the path segment boundary (no sibling-prefix bleed)', () => {
    const ctx = makeCtx({
      folderIdByPath: new Map([
        ['projects', 'f-projects'],
        ['projects-old', 'f-old']
      ]),
      folderPathById: new Map([
        ['f-projects', 'projects'],
        ['f-old', 'projects-old']
      ])
    });
    expect(
      evaluate(parseQuery('folder:projects'), makeEntity({ folderId: 'f-old' }), ctx)
    ).toBe(false);
  });

  it('folder keeps legacy exact-only behavior without folderPathById', () => {
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

describe('evaluate — no: filters (empty folder / tags)', () => {
  it('no:folder matches an entity with no folder', () => {
    expect(evaluate(parseQuery('no:folder'), makeEntity({ folderId: null }), makeCtx())).toBe(true);
  });

  it('no:folder does not match an entity inside a folder', () => {
    expect(
      evaluate(parseQuery('no:folder'), makeEntity({ folderId: 'f-1' }), makeCtx())
    ).toBe(false);
  });

  it('-no:folder is the inverse (only foldered entities)', () => {
    expect(
      evaluate(parseQuery('-no:folder'), makeEntity({ folderId: 'f-1' }), makeCtx())
    ).toBe(true);
    expect(
      evaluate(parseQuery('-no:folder'), makeEntity({ folderId: null }), makeCtx())
    ).toBe(false);
  });

  it('no:tag matches an untagged entity', () => {
    expect(evaluate(parseQuery('no:tag'), makeEntity({ tagIds: [] }), makeCtx())).toBe(true);
  });

  it('no:tag does not match a tagged entity', () => {
    expect(
      evaluate(parseQuery('no:tag'), makeEntity({ tagIds: ['t-1'] }), makeCtx())
    ).toBe(false);
  });

  it('composes with other operators (untagged notes outside any folder)', () => {
    const ast = parseQuery('no:folder no:tag');
    expect(
      evaluate(ast, makeEntity({ folderId: null, tagIds: [] }), makeCtx())
    ).toBe(true);
    expect(
      evaluate(ast, makeEntity({ folderId: null, tagIds: ['t-1'] }), makeCtx())
    ).toBe(false);
    expect(
      evaluate(ast, makeEntity({ folderId: 'f-1', tagIds: [] }), makeCtx())
    ).toBe(false);
  });

  it('no:folder / no:tag never force the content path (metadata-only)', () => {
    expect(requiresContent(parseQuery('no:folder'))).toBe(false);
    expect(requiresContent(parseQuery('no:tag'))).toBe(false);
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

describe('evaluate — Tier 2 boolean OR', () => {
  it('OR matches when either disjunct matches', () => {
    const ast = parseQuery('cat OR dog');
    expect(evaluate(ast, makeEntity({ title: 'My cat is fluffy' }), makeCtx())).toBe(true);
    expect(evaluate(ast, makeEntity({ title: 'A dog at home' }), makeCtx())).toBe(true);
    expect(evaluate(ast, makeEntity({ title: 'A horse on the hill' }), makeCtx())).toBe(false);
  });

  it('OR across operator filters', () => {
    const ctx = makeCtx({
      tagIdByName: new Map([
        ['work', 'tag-w'],
        ['personal', 'tag-p']
      ])
    });
    const ast = parseQuery('tag:work OR tag:personal');
    expect(evaluate(ast, makeEntity({ tagIds: ['tag-w'] }), ctx)).toBe(true);
    expect(evaluate(ast, makeEntity({ tagIds: ['tag-p'] }), ctx)).toBe(true);
    expect(evaluate(ast, makeEntity({ tagIds: [] }), ctx)).toBe(false);
  });

  it('AND binds tighter than OR — `cat dog OR mouse`', () => {
    const ast = parseQuery('cat dog OR mouse');
    // Matches when (cat AND dog) OR mouse holds.
    expect(evaluate(ast, makeEntity({ title: 'cat and dog walk' }), makeCtx())).toBe(true);
    expect(evaluate(ast, makeEntity({ title: 'a mouse alone' }), makeCtx())).toBe(true);
    expect(evaluate(ast, makeEntity({ title: 'cat alone' }), makeCtx())).toBe(false);
  });
});

describe('evaluate — Tier 2 grouping', () => {
  it('group changes precedence', () => {
    const ctx = makeCtx({
      tagIdByName: new Map([['work', 'tag-w']])
    });
    const ast = parseQuery('tag:work AND (is:starred OR is:pinned)');
    // `AND` is not a real keyword (we only have implicit AND); Gmail-like
    // behaviour means literal lowercase "and" is plain text. So tokens here
    // are tag:work, AND (a literal word), and a grouped OR. The literal
    // "and" must appear in title for the AND-arm to match — adjust title.
    expect(
      evaluate(
        ast,
        makeEntity({ title: 'and item', tagIds: ['tag-w'], flags: { starred: true } }),
        ctx
      )
    ).toBe(true);
    expect(
      evaluate(
        ast,
        makeEntity({ title: 'and item', tagIds: ['tag-w'], flags: { pinned: true } }),
        ctx
      )
    ).toBe(true);
    expect(
      evaluate(
        ast,
        makeEntity({ title: 'and item', tagIds: ['tag-w'], flags: {} }),
        ctx
      )
    ).toBe(false);
  });

  it('grouped OR with implicit AND outside', () => {
    const ctx = makeCtx({
      tagIdByName: new Map([['work', 'tag-w']])
    });
    const ast = parseQuery('tag:work (is:starred OR is:pinned)');
    expect(
      evaluate(
        ast,
        makeEntity({ tagIds: ['tag-w'], flags: { starred: true } }),
        ctx
      )
    ).toBe(true);
    expect(
      evaluate(
        ast,
        makeEntity({ tagIds: ['tag-w'], flags: {} }),
        ctx
      )
    ).toBe(false);
    expect(
      evaluate(
        ast,
        makeEntity({ tagIds: [], flags: { starred: true } }),
        ctx
      )
    ).toBe(false);
  });

  it('negated group excludes any inner match', () => {
    const ctx = makeCtx({
      tagIdByName: new Map([['archived', 'tag-a']])
    });
    const ast = parseQuery('-(tag:archived OR is:starred)');
    // Matches entities that are neither tagged archived nor starred.
    expect(
      evaluate(ast, makeEntity({ tagIds: [], flags: {} }), ctx)
    ).toBe(true);
    expect(
      evaluate(ast, makeEntity({ tagIds: ['tag-a'], flags: {} }), ctx)
    ).toBe(false);
    expect(
      evaluate(ast, makeEntity({ tagIds: [], flags: { starred: true } }), ctx)
    ).toBe(false);
  });

  it('negated group also excludes leaf-text matches inside', () => {
    const ast = parseQuery('-(spam OR draft)');
    expect(evaluate(ast, makeEntity({ title: 'inbox' }), makeCtx())).toBe(true);
    expect(evaluate(ast, makeEntity({ title: 'spam folder' }), makeCtx())).toBe(false);
    expect(evaluate(ast, makeEntity({ title: 'draft v2' }), makeCtx())).toBe(false);
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

  it('requiresContent walks through OR and NOT', () => {
    expect(requiresContent(parseQuery('cat OR has:link'))).toBe(true);
    expect(requiresContent(parseQuery('-(has:link)'))).toBe(true);
    expect(requiresContent(parseQuery('cat OR dog'))).toBe(false);
  });
});
