import type { DateExpression, DateRef } from './ast';

/**
 * Parse the value portion of a `created:` / `modified:` / `due:` operator.
 *
 * Accepted forms:
 *   YYYY-MM-DD              → on that day
 *   >YYYY-MM-DD             → after that day (entity date strictly after end-of-day)
 *   <YYYY-MM-DD             → before that day (entity date strictly before start-of-day)
 *   YYYY-MM-DD..YYYY-MM-DD  → between, inclusive on both ends (full days)
 *   today | yesterday       → on that day
 *   <Nd | <Nw | <Nm         → within the last N days/weeks/months
 *                             (mapped to `after` of (now − N units) at parse time)
 *   >Nd | >Nw | >Nm         → older than N days/weeks/months
 *                             (mapped to `before` of (now − N units))
 *
 * Returns null when the value is not a recognizable date expression — the caller
 * (the main parser) then degrades the entire token to freetext, so users typing
 * `created:tomorrow` see their query treated as plain text instead of an error.
 */
export function parseDateExpression(raw: string): DateExpression | null {
  const value = raw.trim();
  if (!value) return null;

  // Range: YYYY-MM-DD..YYYY-MM-DD
  const rangeMatch = value.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch) {
    const from = parseAbsoluteDate(rangeMatch[1]);
    const to = parseAbsoluteDate(rangeMatch[2]);
    if (!from || !to) return null;
    return { op: 'between', from, to };
  }

  // Comparison operators: <expr or >expr
  if (value.startsWith('<') || value.startsWith('>')) {
    const cmp = value[0] as '<' | '>';
    const rest = value.slice(1).trim();
    const ref = parseDateRef(rest);
    if (!ref) return null;

    if (ref.kind === 'days-ago') {
      // Relative: invert mapping — `<7d` (recent) becomes `after (7d ago)`.
      return cmp === '<' ? { op: 'after', date: ref } : { op: 'before', date: ref };
    }
    // Absolute, today, yesterday: standard numeric comparison.
    return cmp === '<' ? { op: 'before', date: ref } : { op: 'after', date: ref };
  }

  // No operator → "on that day"
  const ref = parseDateRef(value);
  if (!ref) return null;
  return { op: 'on', date: ref };
}

function parseDateRef(value: string): DateRef | null {
  const lower = value.toLowerCase();
  if (lower === 'today') return { kind: 'today' };
  if (lower === 'yesterday') return { kind: 'yesterday' };

  // Relative duration: <number><unit> where unit ∈ d|w|m
  const relMatch = lower.match(/^(\d+)([dwm])$/);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    if (!Number.isFinite(n) || n < 0) return null;
    const unit = relMatch[2];
    const days = unit === 'd' ? n : unit === 'w' ? n * 7 : n * 30;
    return { kind: 'days-ago', n: days };
  }

  // Absolute YYYY-MM-DD
  return parseAbsoluteDate(value);
}

function parseAbsoluteDate(value: string): DateRef | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Validate via Date roundtrip (catches Feb 30, etc.)
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return { kind: 'date', year, month, day };
}

/**
 * Resolve a DateRef to concrete start-of-day and end-of-day timestamps in the
 * caller's local timezone (intentionally not UTC — search is a personal,
 * device-local operation; users expect "today" to mean their wall clock).
 */
export function resolveDateRef(
  ref: DateRef,
  now: Date
): { startOfDay: Date; endOfDay: Date } {
  let target: Date;
  switch (ref.kind) {
    case 'date':
      target = new Date(ref.year, ref.month - 1, ref.day);
      break;
    case 'today':
      target = new Date(now);
      break;
    case 'yesterday':
      target = new Date(now);
      target.setDate(target.getDate() - 1);
      break;
    case 'days-ago':
      target = new Date(now);
      target.setDate(target.getDate() - ref.n);
      break;
  }
  const startOfDay = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
    0,
    0,
    0,
    0
  );
  const endOfDay = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
    23,
    59,
    59,
    999
  );
  return { startOfDay, endOfDay };
}
