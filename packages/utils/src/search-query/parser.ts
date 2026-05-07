import type { DateField, Filter, IsFlag, Node, QueryAST } from './ast';
import { parseDateExpression } from './date-parser';

const IS_FLAGS: ReadonlySet<IsFlag> = new Set([
  'starred',
  'pinned',
  'completed',
  'overdue',
  'trashed'
]);

const KNOWN_KEYS = new Set([
  'tag',
  'folder',
  'list',
  'created',
  'modified',
  'due',
  'has',
  'is'
]);

/**
 * Token kinds produced by the tokenizer.
 *
 * `OR` and `AND` are structural tokens — recognized only when the input
 * substring is exactly `OR`/`AND` between whitespace (uppercase, no quotes
 * around it). Any other casing (`or`, `And`) becomes a regular WORD, matching
 * Gmail/GitHub/Linear.
 *
 * `AND` is semantically a no-op: AND is the implicit combinator between
 * primaries, so `cat AND dog` parses identically to `cat dog`. The token
 * exists only so that users who reach for explicit boolean syntax (natural
 * after meeting `OR`) get the result they expect instead of searching for
 * the literal word "and".
 *
 * `(` and `)` always terminate the current token outside quotes — `foo(bar)`
 * tokenizes as WORD `foo`, LPAREN, WORD `bar`, RPAREN. Inside quotes they
 * are preserved as plain characters.
 */
type Token =
  | { kind: 'WORD'; text: string; unquotedColonIdx: number }
  | { kind: 'OR' }
  | { kind: 'AND' }
  | { kind: 'LPAREN' }
  | { kind: 'RPAREN' };

/**
 * Parse a search box input string into a structured tree AST.
 *
 * Tokenization rules:
 *   - Whitespace separates tokens; quoted segments (`"..."`) preserve internal
 *     whitespace, parentheses, and the literal tokens `OR` / `AND`.
 *   - A `:` that is inside quotes does not split key from value.
 *   - `(` / `)` outside quotes are structural tokens.
 *   - A standalone uppercase `OR` between whitespace is the boolean operator.
 *   - A standalone uppercase `AND` between whitespace is a no-op separator
 *     (same precedence as the implicit AND between primaries) — it lets users
 *     write `cat AND dog` symmetrically to `cat OR dog`.
 *   - A token starting with `-` is tentatively negated (parser handles it):
 *       - `-(` opens a negated group.
 *       - `-key:value` (recognized operator) → negated filter leaf.
 *       - `-word` / `-"phrase"` → negated text leaf.
 *
 * Grammar (recursive descent, AND binds tighter than OR):
 *
 *   expr     := or_expr
 *   or_expr  := and_expr ('OR' and_expr)*
 *   and_expr := primary ('AND'? primary)*
 *   primary  := '(' expr ')' | '-' '(' expr ')' | '-' atom | atom
 *   atom     := KEY_VALUE | WORD
 *
 * Graceful degradation:
 *   - Any structural error (unmatched paren, dangling `OR`, empty group in a
 *     mandatory position) falls back to a flat parse where every token is
 *     treated as freetext (parens / `OR` become plain words). The user never
 *     sees a hard error mid-typing.
 */
export function parseQuery(input: string): QueryAST {
  const tokens = tokenize(input);
  if (tokens.length === 0) return { root: null };

  try {
    const parser = new Parser(tokens);
    const node = parser.parseExpr();
    if (!parser.atEnd()) throw new ParseError('trailing tokens');
    return { root: node };
  } catch {
    // Flat fallback: every token (including LPAREN/RPAREN/OR) becomes
    // freetext, AND-combined. Mid-typing inputs always render something.
    return flatFallback(tokens);
  }
}

class ParseError extends Error {}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private peek(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  private advance(): Token | null {
    return this.tokens[this.pos++] ?? null;
  }

  /** expr := or_expr */
  parseExpr(): Node {
    return this.parseOr();
  }

  /** or_expr := and_expr ('OR' and_expr)* */
  private parseOr(): Node {
    const first = this.parseAnd();
    const operands: Node[] = [first];
    while (this.peek()?.kind === 'OR') {
      this.advance();
      const next = this.parseAnd();
      operands.push(next);
    }
    if (operands.length === 1) return first;
    return { kind: 'or', children: operands };
  }

  /**
   * and_expr := primary ('AND'? primary)*
   *
   * `AND` between primaries is consumed and discarded — it has the same
   * precedence as the implicit AND, so `cat AND dog` and `cat dog` produce
   * identical ASTs. A dangling `AND` (no following primary) is a structural
   * error: parsePrimary throws → flat fallback (mirrors how dangling `OR`
   * behaves). Leading `AND` likewise throws because parseAnd starts with
   * parsePrimary, which doesn't accept an AND token.
   */
  private parseAnd(): Node {
    const first = this.parsePrimary();
    const operands: Node[] = [first];
    while (true) {
      const t = this.peek();
      if (t === null) break;
      if (t.kind === 'OR' || t.kind === 'RPAREN') break;
      if (t.kind === 'AND') this.advance(); // optional infix AND
      operands.push(this.parsePrimary());
    }
    if (operands.length === 1) return first;
    return { kind: 'and', children: operands };
  }

  /**
   * primary := '(' expr ')' | '-' '(' expr ')' | '-' atom | atom
   *
   * A bare `-` followed by `(` becomes Not(group). A `-` followed by anything
   * else is part of an atom (negation lives on the leaf), handled by parseAtom.
   */
  private parsePrimary(): Node {
    const t = this.peek();
    if (t === null) throw new ParseError('expected primary, got end of input');

    if (t.kind === 'LPAREN') {
      return this.parseGroup(false);
    }
    if (t.kind === 'WORD' && t.text === '-' && this.tokens[this.pos + 1]?.kind === 'LPAREN') {
      this.advance(); // consume the `-`
      return this.parseGroup(true);
    }
    if (t.kind === 'WORD') {
      this.advance();
      return parseAtom(t.text, t.unquotedColonIdx);
    }
    // OR / AND / RPAREN here are structural errors (dangling boolean,
    // unmatched paren).
    throw new ParseError(`unexpected token kind ${t.kind} in primary`);
  }

  /** Consume `(` expr `)` (or after `-` already consumed). */
  private parseGroup(negated: boolean): Node {
    const open = this.advance();
    if (open?.kind !== 'LPAREN') throw new ParseError('expected `(`');

    // Empty `()` would make parseAnd() throw; intercept it as a no-op group
    // that drops out of its parent (handled by simplification at the caller).
    if (this.peek()?.kind === 'RPAREN') {
      this.advance();
      const empty: Node = { kind: 'and', children: [] }; // TRUE sentinel
      return negated ? { kind: 'not', child: empty } : empty;
    }

    const inner = this.parseExpr();
    const close = this.advance();
    if (close?.kind !== 'RPAREN') throw new ParseError('expected `)`');

    return negated ? { kind: 'not', child: inner } : inner;
  }
}

/**
 * Convert a WORD token (with optional unquoted-colon index) into a leaf node.
 *
 * Order: try operator first, otherwise fall through to leaf-text. A leading
 * `-` on a non-operator word becomes `leaf-text` with `negated: true`. The
 * single-character `-` is preserved as a literal `leaf-text` (so `cat - dog`
 * doesn't lose the dash).
 */
function parseAtom(text: string, unquotedColonIdx: number): Node {
  const negated = text.startsWith('-') && text.length > 1;
  const keyStart = negated ? 1 : 0;

  if (unquotedColonIdx > keyStart) {
    const key = text.slice(keyStart, unquotedColonIdx).toLowerCase();
    if (KNOWN_KEYS.has(key)) {
      const value = text.slice(unquotedColonIdx + 1);
      if (value) {
        const filter = parseOperator(key, value, negated);
        if (filter) return { kind: 'leaf-filter', filter };
      }
    }
  }

  if (negated) {
    return { kind: 'leaf-text', value: text.slice(1).toLowerCase(), negated: true };
  }
  return { kind: 'leaf-text', value: text.toLowerCase(), negated: false };
}

function parseOperator(key: string, value: string, negated: boolean): Filter | null {
  switch (key) {
    case 'tag':
      return { kind: 'tag', value: value.toLowerCase(), negated };

    case 'folder': {
      const normalized = normalizeFolderPath(value);
      if (!normalized) return null;
      return { kind: 'folder', value: normalized, negated };
    }

    case 'list':
      return { kind: 'list', value: value.toLowerCase(), negated };

    case 'created':
    case 'modified':
    case 'due': {
      const expr = parseDateExpression(value);
      if (!expr) return null;
      return { kind: 'date', field: key as DateField, expr, negated };
    }

    case 'has':
      return value.toLowerCase() === 'link'
        ? { kind: 'has', value: 'link', negated }
        : null;

    case 'is': {
      const v = value.toLowerCase();
      return IS_FLAGS.has(v as IsFlag)
        ? { kind: 'is', value: v as IsFlag, negated }
        : null;
    }

    default:
      return null;
  }
}

function normalizeFolderPath(path: string): string {
  return path
    .split('/')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .join('/');
}

/**
 * Reduce every token to a freetext leaf and AND-combine. Used when the
 * recursive-descent parser fails on a structurally invalid input — the user
 * sees a degraded but coherent search instead of an error state.
 *
 * Structural tokens (`(`, `)`, `OR`) become literal words so they can match
 * by substring if the user actually has those characters in their data.
 */
function flatFallback(tokens: Token[]): QueryAST {
  const children: Node[] = [];
  for (const t of tokens) {
    if (t.kind === 'WORD') {
      children.push(parseAtom(t.text, t.unquotedColonIdx));
    } else if (t.kind === 'OR') {
      children.push({ kind: 'leaf-text', value: 'or', negated: false });
    } else if (t.kind === 'AND') {
      children.push({ kind: 'leaf-text', value: 'and', negated: false });
    } else if (t.kind === 'LPAREN') {
      children.push({ kind: 'leaf-text', value: '(', negated: false });
    } else if (t.kind === 'RPAREN') {
      children.push({ kind: 'leaf-text', value: ')', negated: false });
    }
  }
  if (children.length === 0) return { root: null };
  if (children.length === 1) return { root: children[0] };
  return { root: { kind: 'and', children } };
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && isWhitespace(input[i])) i++;
    if (i >= input.length) break;

    const ch = input[i];

    // Structural tokens — only outside quotes, which is the case here because
    // the inner loop below stops as soon as it sees `(`/`)` outside quotes.
    if (ch === '(') {
      tokens.push({ kind: 'LPAREN' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'RPAREN' });
      i++;
      continue;
    }

    // Otherwise consume a WORD (possibly containing quotes / colons).
    let text = '';
    let unquotedColonIdx = -1;
    let inQuotes = false;
    let sawQuotes = false;

    while (i < input.length) {
      const c = input[i];
      if (!inQuotes && (isWhitespace(c) || c === '(' || c === ')')) break;
      if (c === '"') {
        inQuotes = !inQuotes;
        sawQuotes = true;
        i++;
        continue;
      }
      if (c === ':' && !inQuotes && unquotedColonIdx === -1) {
        unquotedColonIdx = text.length;
      }
      text += c;
      i++;
    }

    if (text.length === 0) continue;

    // Standalone `OR`/`AND` (uppercase) are the boolean operators. Quotation
    // around them makes them literals — `"OR"` renders as a phrase WORD with
    // text `OR` but `sawQuotes === true`, so these branches correctly skip
    // it. AND is functionally a no-op (same precedence as implicit AND), the
    // token exists so the parser can swallow it cleanly instead of treating
    // it as a freetext word.
    if (text === 'OR' && !sawQuotes) {
      tokens.push({ kind: 'OR' });
      continue;
    }
    if (text === 'AND' && !sawQuotes) {
      tokens.push({ kind: 'AND' });
      continue;
    }

    tokens.push({ kind: 'WORD', text, unquotedColonIdx });
  }
  return tokens;
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}
