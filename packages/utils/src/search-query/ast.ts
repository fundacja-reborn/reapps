/**
 * AST for the search query language used in reborn-task and reborn-notes search boxes.
 *
 * Supported operators (Tier 1 + 1.5 + 2):
 *   tag:work             — match by tag name
 *   folder:projects/active (notes only) / list:Inbox (task only)
 *   created:>2026-01-01  / created:<7d / created:2026-01-01..2026-02-01
 *   modified:<14d
 *   due:<7d              (task only)
 *   has:link             (forces content-search path)
 *   is:starred | pinned | completed | overdue | trashed
 *   -OPERATOR            negation prefix on operators (-tag:archived, -is:completed)
 *   "quoted value"       allows whitespace and colons in operator values
 *
 * Boolean operators (Tier 2):
 *   foo bar              — implicit AND between consecutive primaries
 *   foo OR bar           — explicit OR (uppercase only — lowercase `or` is plain text)
 *   (foo bar) OR baz     — grouping; precedence is AND > OR
 *   -(tag:work OR is:trashed) — negate a group
 *
 * Freetext (Tier 1.5):
 *   foo                  — substring match against title (and body when populated)
 *   "foo bar"            — phrase: single substring including the whitespace
 *   -mouse               — exclude: leaf-text with negated:true
 *   -"foo bar"           — exclude phrase
 *
 * Graceful degradation (Tier 2):
 *   Unmatched parens or dangling `OR` fall back to a flat parse where the
 *   offending characters become plain freetext — the user never sees a
 *   hard error mid-typing.
 */

export type DateField = 'created' | 'modified' | 'due';

export type DateRef =
  | { kind: 'date'; year: number; month: number; day: number }
  | { kind: 'days-ago'; n: number }
  | { kind: 'today' }
  | { kind: 'yesterday' };

/**
 * Normalized date predicate.
 *
 * Relative-time mapping note: `<7d` is parsed to `{ op: 'after', date: 7-days-ago }`
 * because "less than 7 days ago" semantically equals "after the (now − 7d) point".
 * This way the evaluator only deals with three primitives (before/after/on/between)
 * and the asymmetry between `<7d` (recent) vs `<2026-01-01` (older) is normalized
 * away at parse time — see `date-parser.ts`.
 */
export type DateExpression =
  | { op: 'before'; date: DateRef } // entity.date < dateRef
  | { op: 'after'; date: DateRef } // entity.date > dateRef
  | { op: 'on'; date: DateRef } // entity.date falls on the same calendar day
  | { op: 'between'; from: DateRef; to: DateRef }; // entity.date >= from-start-of-day && entity.date <= to-end-of-day

export type IsFlag = 'starred' | 'pinned' | 'completed' | 'overdue' | 'trashed';

export type HasFlag = 'link';

export type Filter =
  | { kind: 'tag'; value: string; negated: boolean }
  | { kind: 'folder'; value: string; negated: boolean }
  | { kind: 'list'; value: string; negated: boolean }
  | { kind: 'date'; field: DateField; expr: DateExpression; negated: boolean }
  | { kind: 'has'; value: HasFlag; negated: boolean }
  | { kind: 'is'; value: IsFlag; negated: boolean };

/**
 * Tree-shaped AST node. AND / OR are n-ary so a flat sequence like
 * `cat dog mouse` becomes a single `And([…])` instead of nesting binary ANDs.
 *
 * Leaf-level `negated` is preserved on `Filter` (Tier 1.5 syntax `-tag:archived`)
 * and on `leaf-text` (`-mouse`). `Not(child)` is reserved for explicit group
 * negation (`-(group)`), which has no leaf-level equivalent.
 *
 * TRUE / FALSE sentinels used by the lite-AST builder are encoded as
 * `{ kind: 'and', children: [] }` (TRUE — `every` over empty is true) and
 * `{ kind: 'or', children: [] }` (FALSE — `some` over empty is false). This
 * keeps the type closed without adding sentinel kinds.
 */
export type Node =
  | { kind: 'and'; children: Node[] }
  | { kind: 'or'; children: Node[] }
  | { kind: 'not'; child: Node }
  | { kind: 'leaf-filter'; filter: Filter }
  | { kind: 'leaf-text'; value: string; negated: boolean };

export interface QueryAST {
  /** `null` represents an empty query (matches everything). */
  root: Node | null;
}

/**
 * Returns true if any leaf in the AST requires decrypting entity body —
 * currently only `has:link`. Used by the search wrapper to decide between
 * the title-instant path and the content-async path.
 */
export function requiresContent(ast: QueryAST): boolean {
  return ast.root !== null && nodeRequiresContent(ast.root);
}

function nodeRequiresContent(node: Node): boolean {
  switch (node.kind) {
    case 'and':
    case 'or':
      return node.children.some(nodeRequiresContent);
    case 'not':
      return nodeRequiresContent(node.child);
    case 'leaf-filter':
      return node.filter.kind === 'has';
    case 'leaf-text':
      return false;
  }
}

/** True when the AST has no root — i.e. the query is empty. */
export function isEmpty(ast: QueryAST): boolean {
  return ast.root === null;
}
