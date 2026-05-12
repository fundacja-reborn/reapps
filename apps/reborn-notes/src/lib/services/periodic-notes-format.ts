/**
 * Pure-function helpers for Periodic Notes:
 * - `formatName`: produce the note title for Daily/Weekly/Monthly notes from a
 *   token-based format string. No I/O, no DOM — safe to unit-test in isolation.
 * - `formatRange`: build a human-readable range string used in tooltips and the
 *   Settings preview ("4–10 maja 2026", "maj 2026", "2026-05-08 piątek").
 *
 * The format DSL is a tiny subset modelled after Obsidian / dayjs tokens, kept
 * intentionally small. Anything inside `[…]` is emitted verbatim so users can
 * write `YYYY-[W]ww` and get `2026-W19` (not `2026-FW19` or similar).
 *
 * Falls back to a sane default if the formatter throws on user input — see
 * `periodic-notes.service.ts` `getOrCreateNote` callsite.
 */
import type { PeriodicKind } from '@reborn/storage';
import { getMondayOfWeek, getSundayOfWeek, getISOWeek } from '../utils/iso-week';

/**
 * Date the note is *anchored to*, given the kind and the moment of click:
 * - daily → the day itself
 * - weekly → the Monday of that ISO week
 * - monthly → the first day of that month
 */
export function getAnchorDate(kind: PeriodicKind, now: Date): Date {
  if (kind === 'weekly') return getMondayOfWeek(now);
  if (kind === 'monthly') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Two-digit zero-padded number. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Locale-independent ISO `YYYY-MM-DD` anchor for matching periodic notes.
 * Locked to the anchor day per kind (see `getAnchorDate`). This is what gets
 * stamped into `metadata_encrypted.periodic.anchor` and what
 * `findExistingPeriodicNote` matches against - locale-dependent titles
 * (`Monday` / `poniedziałek`) cannot create duplicates because matching
 * ignores them.
 */
export function getAnchorIso(kind: PeriodicKind, now: Date): string {
  const anchor = getAnchorDate(kind, now);
  return `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}-${pad2(anchor.getDate())}`;
}

/**
 * Parse the anchor ISO date from a title that uses one of the default formats.
 * Returns the YYYY-MM-DD anchor or `null` if the title doesn't start with a
 * recognizable date prefix. Used as a fallback for legacy notes that were
 * created before metadata-based matching existed.
 *
 *   daily/weekly default: 'YYYY-MM-DD …'  → match first 10 chars
 *   monthly default:      'YYYY-MM'       → match first 7 chars, normalize to YYYY-MM-01
 *
 * Callers should validate that the parsed date actually exists (regex doesn't
 * reject 2026-13-32). We re-construct a Date and round-trip to be safe.
 */
export function parseTitleAnchor(title: string, kind: PeriodicKind): string | null {
  if (kind === 'monthly') {
    const m = title.match(/^(\d{4})-(\d{2})\b/);
    if (!m) return null;
    const [, y, mo] = m;
    const d = new Date(Number(y), Number(mo) - 1, 1);
    if (d.getFullYear() !== Number(y) || d.getMonth() !== Number(mo) - 1) return null;
    return `${y}-${mo}-01`;
  }
  // daily & weekly: titles begin with `YYYY-MM-DD`
  const m = title.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (!m) return null;
  const [, y, mo, day] = m;
  const d = new Date(Number(y), Number(mo) - 1, Number(day));
  if (
    d.getFullYear() !== Number(y) ||
    d.getMonth() !== Number(mo) - 1 ||
    d.getDate() !== Number(day)
  ) {
    return null;
  }
  return `${y}-${mo}-${day}`;
}

/**
 * Format a Date using a token-based format string.
 *
 * Supported tokens (longest matched first inside one segment):
 * - `YYYY` 4-digit year, `YY` 2-digit year
 * - `MMMM` full month name, `MMM` abbreviated month name, `MM` zero-padded
 *   number, `M` non-padded number
 * - `DD` zero-padded day, `D` non-padded day
 * - `dddd` full weekday, `ddd` abbreviated weekday
 * - `ww` zero-padded ISO week number, `w` non-padded ISO week number
 *
 * Square brackets `[literal]` emit their contents verbatim — escape any token
 * you want printed literally. Year tokens inside brackets are not interpreted.
 *
 * For `weekly`/`monthly` kinds, callers should pass the *anchor* date returned
 * by `getAnchorDate(kind, now)` rather than `now` itself, so the title reflects
 * the period (e.g. Monday-of-week) and not the click moment.
 */
export function formatName(date: Date, format: string, locale: string): string {
  const monthLong = new Intl.DateTimeFormat(locale, { month: 'long' }).format(date);
  const monthShort = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
  const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  const weekdayShort = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);

  const { week } = getISOWeek(date);

  // Walk the format string, copying literals through and replacing tokens.
  let out = '';
  let i = 0;
  while (i < format.length) {
    const ch = format[i];

    // Literal segment — copy until matching ']'.
    if (ch === '[') {
      const end = format.indexOf(']', i + 1);
      if (end === -1) {
        // Unmatched '[' → emit raw character and continue.
        out += ch;
        i += 1;
        continue;
      }
      out += format.slice(i + 1, end);
      i = end + 1;
      continue;
    }

    // Try multi-character tokens, longest first.
    const rest = format.slice(i);
    if (rest.startsWith('YYYY')) {
      out += String(date.getFullYear());
      i += 4;
      continue;
    }
    if (rest.startsWith('YY')) {
      out += String(date.getFullYear() % 100).padStart(2, '0');
      i += 2;
      continue;
    }
    if (rest.startsWith('MMMM')) {
      out += monthLong;
      i += 4;
      continue;
    }
    if (rest.startsWith('MMM')) {
      out += monthShort;
      i += 3;
      continue;
    }
    if (rest.startsWith('MM')) {
      out += pad2(date.getMonth() + 1);
      i += 2;
      continue;
    }
    if (rest.startsWith('M')) {
      out += String(date.getMonth() + 1);
      i += 1;
      continue;
    }
    if (rest.startsWith('DD')) {
      out += pad2(date.getDate());
      i += 2;
      continue;
    }
    if (rest.startsWith('D')) {
      out += String(date.getDate());
      i += 1;
      continue;
    }
    if (rest.startsWith('dddd')) {
      out += weekdayLong;
      i += 4;
      continue;
    }
    if (rest.startsWith('ddd')) {
      out += weekdayShort;
      i += 3;
      continue;
    }
    if (rest.startsWith('ww')) {
      out += pad2(week);
      i += 2;
      continue;
    }
    if (rest.startsWith('w')) {
      out += String(week);
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Build a human-readable range hint shown in tooltips on the nav buttons
 * and as the helper line under the Settings preview.
 *
 * - daily   → "2026-05-08 piątek"
 * - weekly  → "4–10 maja 2026" (Monday-Sunday in user's locale, inflected)
 * - monthly → "maj 2026"
 *
 * Weekly delegates to `Intl.DateTimeFormat.formatRange` so that locales which
 * inflect month names with day numbers (PL/RU/UK genitive) produce the natural
 * form. For locales without that distinction (EN/DE/FR/ES), the platform output
 * is already correct.
 */
export function formatRange(kind: PeriodicKind, now: Date, locale: string): string {
  if (kind === 'daily') {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now);
    const iso = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    return `${iso} ${weekday}`;
  }

  if (kind === 'monthly') {
    const monthLong = new Intl.DateTimeFormat(locale, { month: 'long' }).format(now);
    return `${monthLong} ${now.getFullYear()}`;
  }

  // weekly — Intl handles inflection + range collapsing per locale.
  const monday = getMondayOfWeek(now);
  const sunday = getSundayOfWeek(now);
  const fmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  return fmt.formatRange(monday, sunday);
}

/**
 * Compute the title for a periodic note given the kind, click moment, format
 * string and locale. Falls back to default-format output if user-supplied
 * format throws (e.g. malformed token sequence) — caller doesn't need to wrap.
 */
export function buildPeriodicTitle(
  kind: PeriodicKind,
  now: Date,
  format: string,
  defaultFormat: string,
  locale: string
): string {
  const anchor = getAnchorDate(kind, now);
  try {
    const result = formatName(anchor, format, locale);
    if (result.trim().length === 0) throw new Error('empty title');
    return result;
  } catch {
    return formatName(anchor, defaultFormat, locale);
  }
}
