/**
 * AST for the search query language used in reborn-task and reborn-notes search boxes.
 *
 * Supported operators (Tier 1):
 *   tag:work             — match by tag name
 *   folder:projects/active (notes only) / list:Inbox (task only)
 *   created:>2026-01-01  / created:<7d / created:2026-01-01..2026-02-01
 *   modified:<14d
 *   due:<7d              (task only)
 *   has:link             (forces content-search path)
 *   is:starred | pinned | completed | overdue | trashed
 *   -OPERATOR            negation prefix
 *   "quoted value"       allows whitespace and colons in operator values
 *   freetext             everything else; AND-combined as substring match against title
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

export interface QueryAST {
  /** Lowercased, space-joined non-operator tokens. Empty string when query has only operators. */
  freetext: string;
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

/**
 * Returns true when the AST has neither operators nor freetext — i.e. an empty query.
 */
export function isEmpty(ast: QueryAST): boolean {
  return ast.freetext.length === 0 && ast.filters.length === 0;
}
