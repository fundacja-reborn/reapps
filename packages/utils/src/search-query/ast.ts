/**
 * AST for the search query language used in reborn-task and reborn-notes search boxes.
 *
 * Supported operators (Tier 1 + 1.5):
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
 * Freetext (Tier 1.5):
 *   foo bar              — AND-combined word substrings (each word must appear)
 *   "foo bar"            — phrase: single substring including the whitespace
 *   -mouse               — exclude: tokens prefixed with `-` whose body is not a
 *                          recognized operator are subtractive (must NOT appear)
 *   -"foo bar"           — exclude phrase
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
 * Plain-text portion of the query. Each item in `include` and `exclude` is a
 * pre-split, lowercased substring; phrases (`"foo bar"`) keep their internal
 * whitespace as one item, while bare words (`foo bar`) become two items.
 *
 * Evaluator semantics:
 *   - All `include` items must appear in the haystack (title, plus body when
 *     the body-aware path populates it). AND-combined.
 *   - No `exclude` item may appear in the haystack.
 */
export interface FreetextSpec {
  include: string[];
  exclude: string[];
}

export interface QueryAST {
  freetext: FreetextSpec;
  /** All recognized operators. AND-combined. */
  filters: Filter[];
}

/**
 * Returns true if any filter requires decrypting entity body (description/content).
 * Used by the search wrapper to decide between title-instant and content-async paths.
 */
export function requiresContent(ast: QueryAST): boolean {
  return ast.filters.some((f) => f.kind === 'has' && f.value === 'link');
}

/** True when the freetext portion has no include and no exclude items. */
export function freetextIsEmpty(ft: FreetextSpec): boolean {
  return ft.include.length === 0 && ft.exclude.length === 0;
}

/**
 * Returns true when the AST has neither operators nor freetext — i.e. an empty query.
 */
export function isEmpty(ast: QueryAST): boolean {
  return freetextIsEmpty(ast.freetext) && ast.filters.length === 0;
}
