import type { Node, QueryAST } from '@reborn/utils';

/**
 * AND-combine a smart folder's membership query (`base`) with the interactive
 * search-box query (`refine`) into a single AST, dropping empty (null-root)
 * operands:
 *
 *   - empty base   → `refine` unchanged (normal folder / all-notes view)
 *   - empty refine → `base` unchanged (smart folder with no sub-filter)
 *   - both present → `{ kind: 'and', children: [base, refine] }` (must match both)
 *   - both empty   → empty AST (`root: null`, matches everything)
 *
 * Composing into one AST lets notes.store's existing content/title routing
 * (`requiresContent` → `evaluateAgainstIndex` vs `triggerContentSearch`) handle
 * the combination unchanged, instead of running a separate two-pass filter.
 */
export function combineAnd(base: QueryAST, refine: QueryAST): QueryAST {
  if (base.root === null) return refine;
  if (refine.root === null) return base;
  const children: Node[] = [base.root, refine.root];
  return { root: { kind: 'and', children } };
}
