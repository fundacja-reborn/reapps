import type { Node, QueryAST } from './ast';

/**
 * Build a "lite" version of the AST suitable for pre-filtering an in-memory
 * index before the streaming-decrypt body-aware pass.
 *
 * Rationale: full evaluation needs the decrypted body for `leaf-text` (which
 * may match against title+body) and `has:*` filters (which inspect body
 * content). Pre-filtering with the full AST would exclude entries whose only
 * match is in body — the regression we hit before adopting this two-pass
 * design. The lite AST replaces those body-dependent leaves with a polarity-
 * aware sentinel so the boolean tree simplifies to a sound over-approximation.
 *
 * Soundness contract: the lite AST may **over-match** (false positives,
 * filtered out by the full evaluator after decryption). It must NEVER
 * **under-match** — every entry that matches the full AST must also match
 * the lite AST.
 *
 * Why polarity matters: replacing a body-dependent leaf with a constant only
 * stays sound if the constant is the over-approximation of the leaf in its
 * context. Inside an even number of NOTs (positive polarity, where `cat` acts
 * additively) the over-approximation is TRUE — `cat` could be true, so we
 * assume it is. Inside an odd number of NOTs (negative polarity, where `cat`
 * subtracts), we need `cat` to be FALSE so that the surrounding NOT becomes
 * TRUE (still permissive). Concretely:
 *
 *   `-(cat) tag:work` → AND(NOT(leaf 'cat'), tag:work)
 *   With naive strip (leaf → TRUE): NOT(TRUE) = FALSE → AND collapses to FALSE,
 *   pre-filter returns nothing — but full AST matches `tag:work` items
 *   without "cat". That's an under-match. With polarity strip
 *   (leaf in negative polarity → FALSE): NOT(FALSE) = TRUE, AND → tag:work. ✓
 *
 * Sentinel encoding: TRUE is `{ kind: 'and', children: [] }` (because
 * `every` over an empty array is `true`); FALSE is `{ kind: 'or', children: [] }`
 * (`some` over empty is `false`). The native evaluator handles both correctly
 * without special-case code.
 */
export function buildLiteAst(ast: QueryAST): QueryAST {
  if (ast.root === null) return { root: null };
  const stripped = strip(ast.root, 'positive');
  const lite = simplify(stripped);
  if (isTrue(lite)) return { root: null }; // matches everything → empty AST
  return { root: lite };
}

const TRUE: Node = { kind: 'and', children: [] };
const FALSE: Node = { kind: 'or', children: [] };

type Polarity = 'positive' | 'negative';

function flip(p: Polarity): Polarity {
  return p === 'positive' ? 'negative' : 'positive';
}

function isTrue(node: Node): boolean {
  return node.kind === 'and' && node.children.length === 0;
}

function isFalse(node: Node): boolean {
  return node.kind === 'or' && node.children.length === 0;
}

/**
 * Replace body-dependent leaves with the polarity-correct sentinel.
 *
 *   - leaf-text  in positive polarity → TRUE  (over-approximate as "matches")
 *   - leaf-text  in negative polarity → FALSE (so the surrounding NOT becomes
 *                                              TRUE, still permissive)
 *   - has:*      handled the same way
 *
 * The leaf's own `negated` flag (Tier 1.5 leaf-level negation, e.g. `-cat`)
 * does not change the sentinel. Both the positive form and the negated form
 * collapse to the same polarity-driven constant — the post-decryption pass
 * is what actually checks the leaf semantics.
 */
function strip(node: Node, polarity: Polarity): Node {
  switch (node.kind) {
    case 'and':
      return { kind: 'and', children: node.children.map((c) => strip(c, polarity)) };
    case 'or':
      return { kind: 'or', children: node.children.map((c) => strip(c, polarity)) };
    case 'not':
      return { kind: 'not', child: strip(node.child, flip(polarity)) };
    case 'leaf-filter':
      if (node.filter.kind === 'has') {
        return polarity === 'positive' ? TRUE : FALSE;
      }
      return node;
    case 'leaf-text':
      return polarity === 'positive' ? TRUE : FALSE;
  }
}

/**
 * Collapse TRUE/FALSE sentinels through the tree:
 *
 *   AND(…, TRUE, …)  → drop TRUE; if all dropped → TRUE
 *   AND(…, FALSE, …) → FALSE
 *   OR(…, TRUE, …)   → TRUE
 *   OR(…, FALSE, …)  → drop FALSE; if all dropped → FALSE
 *   NOT(TRUE)        → FALSE
 *   NOT(FALSE)       → TRUE
 *   AND([single])    → unwrap
 *   OR([single])     → unwrap
 *
 * Bottom-up: simplify children before collapsing the parent.
 */
function simplify(node: Node): Node {
  switch (node.kind) {
    case 'and': {
      const children = node.children.map(simplify);
      const out: Node[] = [];
      for (const c of children) {
        if (isFalse(c)) return FALSE;
        if (isTrue(c)) continue;
        out.push(c);
      }
      if (out.length === 0) return TRUE;
      if (out.length === 1) return out[0];
      return { kind: 'and', children: out };
    }
    case 'or': {
      const children = node.children.map(simplify);
      const out: Node[] = [];
      for (const c of children) {
        if (isTrue(c)) return TRUE;
        if (isFalse(c)) continue;
        out.push(c);
      }
      if (out.length === 0) return FALSE;
      if (out.length === 1) return out[0];
      return { kind: 'or', children: out };
    }
    case 'not': {
      const inner = simplify(node.child);
      if (isTrue(inner)) return FALSE;
      if (isFalse(inner)) return TRUE;
      return { kind: 'not', child: inner };
    }
    case 'leaf-filter':
    case 'leaf-text':
      return node;
  }
}
