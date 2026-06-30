/**
 * Locale-aware relative expiry, e.g. "in 6 days" / "za 6 dni" / "tomorrow".
 *
 * Uses the platform `Intl.RelativeTimeFormat`, so the phrasing and plural rules
 * come from the runtime per locale - no per-locale translation strings needed
 * for the number itself. The caller renders a localized "Expired" label (in a
 * destructive colour) when `expired` is true.
 *
 * `now` is injectable for deterministic tests; defaults to the current time.
 */
export function formatExpiryRelative(
  iso: string | null,
  locale: string,
  now: number = Date.now()
): { text: string; expired: boolean } | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;

  const diffMs = ts - now;
  if (diffMs <= 0) return { text: '', expired: true };

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const rtf = new Intl.RelativeTimeFormat(locale || 'en', { numeric: 'auto' });
  let text: string;
  if (diffMs >= DAY) text = rtf.format(Math.round(diffMs / DAY), 'day');
  else if (diffMs >= HOUR) text = rtf.format(Math.round(diffMs / HOUR), 'hour');
  else text = rtf.format(Math.max(1, Math.round(diffMs / MINUTE)), 'minute');

  return { text, expired: false };
}
