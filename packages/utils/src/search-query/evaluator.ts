import type { DateExpression, Filter, Node, QueryAST } from './ast';
import { resolveDateRef } from './date-parser';

/**
 * Normalized entity passed to the evaluator. Each app builds its own adapter
 * (e.g. from NoteIndexEntry / TaskIndexEntry) before invoking `evaluate()`.
 *
 * `body` is optional: in the title-instant search path it stays undefined so
 * the evaluator only matches against `title`. The content-async path populates
 * `body` after decryption, enabling `has:link` and substring matches across
 * description/content.
 */
export interface SearchEntity {
  id: string;
  title: string;
  body?: string;
  tagIds: string[];
  folderId: string | null;
  listId: string | null;
  createdAt: Date;
  updatedAt: Date;
  dueAt: Date | null;
  flags: {
    starred?: boolean;
    pinned?: boolean;
    completed?: boolean;
    trashed?: boolean;
  };
}

/**
 * Per-search lookup tables, built once per query from the per-app stores
 * (tagStore, folderStore, listStore). All keys are lowercased to match the
 * lowercasing the parser applies to operator values.
 */
export interface SearchContext {
  tagIdByName: Map<string, string>;
  folderIdByPath: Map<string, string>;
  listIdByName: Map<string, string>;
  now: Date;
}

// CodeQL js/polynomial-redos: previously `/(https?:\/\/[^\s)]+|\[[^\]]*\]\([^)]+\))/i`
// where `[^\]]*` and `[^)]+` quantifiers backtracked O(n²) on adversarial body
// (e.g. `[[[[…` with no closing). The Markdown branch is now a linear indexOf scan.
const PLAIN_URL_REGEX = /https?:\/\//i;

function bodyContainsLink(body: string): boolean {
  if (PLAIN_URL_REGEX.test(body)) return true;
  let i = 0;
  while ((i = body.indexOf('[', i)) !== -1) {
    const close = body.indexOf(']', i + 1);
    if (close === -1) return false;
    if (body.charCodeAt(close + 1) === 40 /* '(' */) {
      const closeParen = body.indexOf(')', close + 2);
      if (closeParen > close + 2) return true;
    }
    i = close + 1;
  }
  return false;
}

/**
 * Walks the tree AST and returns true iff the entity satisfies the query.
 *
 * Empty AST (`root === null`) matches everything — consumers lean on this so
 * they don't need a special `isEmpty` early-return at every call site.
 *
 * The haystack (lowercased title + optional body) is computed once per
 * `evaluate()` call and shared across every leaf-text node, so a query like
 * `cat OR dog OR mouse` doesn't rebuild the same string three times.
 */
export function evaluate(ast: QueryAST, entity: SearchEntity, ctx: SearchContext): boolean {
  if (ast.root === null) return true;
  const haystack = buildHaystack(entity);
  return evalNode(ast.root, entity, ctx, haystack);
}

function evalNode(
  node: Node,
  entity: SearchEntity,
  ctx: SearchContext,
  haystack: string
): boolean {
  switch (node.kind) {
    case 'and':
      return node.children.every((c) => evalNode(c, entity, ctx, haystack));
    case 'or':
      return node.children.some((c) => evalNode(c, entity, ctx, haystack));
    case 'not':
      return !evalNode(node.child, entity, ctx, haystack);
    case 'leaf-filter':
      return checkFilter(node.filter, entity, ctx);
    case 'leaf-text': {
      const present = haystack.includes(node.value);
      return node.negated ? !present : present;
    }
  }
}

function buildHaystack(entity: SearchEntity): string {
  return (
    entity.title.toLowerCase() +
    (entity.body !== undefined ? '\n' + entity.body.toLowerCase() : '')
  );
}

function checkFilter(filter: Filter, entity: SearchEntity, ctx: SearchContext): boolean {
  const matched = matchFilterPositive(filter, entity, ctx);
  return filter.negated ? !matched : matched;
}

function matchFilterPositive(
  filter: Filter,
  entity: SearchEntity,
  ctx: SearchContext
): boolean {
  switch (filter.kind) {
    case 'tag': {
      const tagId = ctx.tagIdByName.get(filter.value);
      return tagId ? entity.tagIds.includes(tagId) : false;
    }

    case 'folder': {
      const folderId = ctx.folderIdByPath.get(filter.value);
      return folderId ? entity.folderId === folderId : false;
    }

    case 'list': {
      const listId = ctx.listIdByName.get(filter.value);
      return listId ? entity.listId === listId : false;
    }

    case 'date': {
      const ts =
        filter.field === 'created'
          ? entity.createdAt
          : filter.field === 'modified'
            ? entity.updatedAt
            : entity.dueAt;
      if (!ts) return false;
      return matchDateExpression(filter.expr, ts, ctx.now);
    }

    case 'has': {
      if (filter.value === 'link') {
        return entity.body !== undefined && bodyContainsLink(entity.body);
      }
      return false;
    }

    case 'is': {
      switch (filter.value) {
        case 'starred':
          return !!entity.flags.starred;
        case 'pinned':
          return !!entity.flags.pinned;
        case 'completed':
          return !!entity.flags.completed;
        case 'trashed':
          return !!entity.flags.trashed;
        case 'overdue':
          return (
            entity.dueAt !== null &&
            entity.dueAt < ctx.now &&
            !entity.flags.completed &&
            !entity.flags.trashed
          );
      }
    }
  }
}

function matchDateExpression(expr: DateExpression, ts: Date, now: Date): boolean {
  switch (expr.op) {
    case 'before': {
      const { startOfDay } = resolveDateRef(expr.date, now);
      return ts < startOfDay;
    }
    case 'after': {
      const { endOfDay } = resolveDateRef(expr.date, now);
      return ts > endOfDay;
    }
    case 'on': {
      const { startOfDay, endOfDay } = resolveDateRef(expr.date, now);
      return ts >= startOfDay && ts <= endOfDay;
    }
    case 'between': {
      const { startOfDay } = resolveDateRef(expr.from, now);
      const { endOfDay } = resolveDateRef(expr.to, now);
      return ts >= startOfDay && ts <= endOfDay;
    }
  }
}

/**
 * Convenience builder for a SearchContext with empty resolvers — useful in tests
 * and when an app's resolver isn't ready yet (operators against unbuilt resolvers
 * simply return no matches, which negation can flip to "all").
 */
export function emptySearchContext(now: Date = new Date()): SearchContext {
  return {
    tagIdByName: new Map(),
    folderIdByPath: new Map(),
    listIdByName: new Map(),
    now
  };
}
