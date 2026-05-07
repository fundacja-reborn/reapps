import type { DateField, Filter, FreetextSpec, IsFlag, QueryAST } from './ast';
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

interface RawToken {
  /** Token contents with surrounding quotes stripped, but `-` prefix preserved. */
  text: string;
  /** Index inside `text` of the first unquoted `:`, or -1 when none. */
  unquotedColonIdx: number;
}

/**
 * Parse a search box input string into a structured AST.
 *
 * Tokenization rules:
 *   - Whitespace separates tokens; quoted segments (`"..."`) preserve internal whitespace.
 *   - A `:` that is inside quotes does not split key from value.
 *   - A token starting with `-` is tentatively negated:
 *       - If the rest forms a recognized operator → negated operator filter.
 *       - Otherwise → freetext exclude (Tier 1.5; the leading `-` is stripped).
 *   - Unknown operator keys, malformed dates, or `is:` flags outside the supported
 *     set degrade the entire token to freetext (no errors, no warnings — the user
 *     simply gets a substring search). This matters because users mid-typing should
 *     never see a hard failure.
 *   - Multi-word phrases inside quotes stay as a single freetext item, so
 *     `"meeting prep"` matches the literal substring with whitespace.
 */
export function parseQuery(input: string): QueryAST {
  const tokens = tokenize(input);
  const filters: Filter[] = [];
  const include: string[] = [];
  const exclude: string[] = [];

  for (const tok of tokens) {
    const classified = classify(tok);
    if (classified.kind === 'filter') {
      filters.push(classified.filter);
      continue;
    }
    if (classified.kind === 'exclude') {
      exclude.push(classified.value);
    } else {
      include.push(classified.value);
    }
  }

  const freetext: FreetextSpec = { include, exclude };
  return { freetext, filters };
}

function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && isWhitespace(input[i])) i++;
    if (i >= input.length) break;

    let text = '';
    let unquotedColonIdx = -1;
    let inQuotes = false;

    while (i < input.length && (inQuotes || !isWhitespace(input[i]))) {
      const ch = input[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        i++;
        continue;
      }
      if (ch === ':' && !inQuotes && unquotedColonIdx === -1) {
        unquotedColonIdx = text.length;
      }
      text += ch;
      i++;
    }

    if (text.length > 0) {
      tokens.push({ text, unquotedColonIdx });
    }
  }
  return tokens;
}

type ClassifyResult =
  | { kind: 'filter'; filter: Filter }
  | { kind: 'include'; value: string }
  | { kind: 'exclude'; value: string };

function classify(token: RawToken): ClassifyResult {
  const { text, unquotedColonIdx } = token;
  const negated = text.startsWith('-');
  const keyStart = negated ? 1 : 0;

  // Try operator first (with or without `-` prefix). Need a non-empty key
  // before the colon and a colon past `keyStart`.
  if (unquotedColonIdx > keyStart) {
    const key = text.slice(keyStart, unquotedColonIdx).toLowerCase();
    if (KNOWN_KEYS.has(key)) {
      const value = text.slice(unquotedColonIdx + 1);
      if (value) {
        const filter = parseOperator(key, value, negated);
        if (filter) return { kind: 'filter', filter };
      }
    }
  }

  // Not an operator — treat as freetext. A leading `-` on a non-operator token
  // means "exclude this substring", but only when there's something after it
  // (a bare `-` stays as include). Lowercase for case-insensitive matching;
  // empty results are dropped by the caller.
  if (negated && text.length > 1) {
    return { kind: 'exclude', value: text.slice(1).toLowerCase() };
  }
  return { kind: 'include', value: text.toLowerCase() };
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

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}
