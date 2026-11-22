import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  formatViolations,
  listSourceFiles,
  repoRelative,
  scanPaths
} from '../../../../scripts/check-rtl-direction.mjs';
import { appRuntimeKeys, missingKeyRefs } from '../../../../scripts/i18n-messages.mjs';

/**
 * Source guards for RTL readiness (reapps-docs planning/arabic-rtl-plan.md,
 * Phase 1). Kept in this project's own test target so `nx affected -t test`
 * runs them whenever apps/reborn-notes/src changes.
 */
const ROOT = 'apps/reborn-notes/src';

describe('UI source guards (apps/reborn-notes/src)', () => {
  it('uses logical direction utilities, not physical ones (RTL)', () => {
    // Fix: `node scripts/check-rtl-direction.mjs --fix apps/reborn-notes/src`, or mark a
    // deliberately physical value with `rtl-ignore-next-line: <reason>`.
    expect(formatViolations(scanPaths([ROOT]))).toBe('');
  });

  it('never renders a translation as raw HTML ({@html $t(...)})', () => {
    // Translations are escaped by Svelte. Rendering one through {@html} would
    // turn every locale file (soon including community translations) into an
    // XSS vector - build the markup in the component instead.
    const hits = listSourceFiles([ROOT])
      .filter((file) => file.endsWith('.svelte'))
      .flatMap((file) =>
        readFileSync(file, 'utf-8')
          .split('\n')
          .flatMap((line, i) =>
            /\{@html\s+\$(t|_|json)\s*\(/.test(line) ? [`${repoRelative(file)}:${i + 1}`] : []
          )
      );
    expect(hits).toEqual([]);
  });

  it('asks only for translation keys that exist ($t("...") in common + notes)', () => {
    // A missing key renders as the key itself: the export form showed
    // "settings_page.export_import.password_too_short" (2026-11-22). Locale
    // parity can't see it, the key is missing in all six files alike. Fix: add
    // the key to every locale (or use an existing one).
    const sources = listSourceFiles([ROOT])
      .filter((file) => /\.(svelte|ts)$/.test(file) && !/\.(spec|test)\.ts$/.test(file))
      .map((file) => ({ path: repoRelative(file), text: readFileSync(file, 'utf-8') }));
    // The catalogs this app loads (i18n.store: apps ['common', 'notes']).
    expect(missingKeyRefs(sources, appRuntimeKeys(['common', 'notes']))).toEqual([]);
  });

  it('sizes text in rem, not fixed px (text size setting, #511)', () => {
    // The interface scale is `font-size: N%` on <html>: text sized in px would
    // not grow with it. Write the rem equivalent (11px = 0.6875rem); in note
    // content use calc(Xrem * var(--rn-note-scale, 1)). Exempt: the service
    // worker's offline page (outside the app) and the PDF export (pt/em in a
    // fixed-width off-screen box, deliberately independent of the screen).
    const EXEMPT = ['/service-worker.ts', '/lib/services/export-import.service.ts'];
    const PX_TEXT = /text-\[\d+(\.\d+)?px\]|font-size:\s*\d+(\.\d+)?px|fontSize:\s*'\d+(\.\d+)?px'/;
    const hits = listSourceFiles([ROOT])
      .filter((file) => /\.(svelte|ts|css)$/.test(file) && !/\.(spec|test)\.ts$/.test(file))
      .filter((file) => !EXEMPT.some((suffix) => file.endsWith(suffix)))
      .flatMap((file) =>
        readFileSync(file, 'utf-8')
          .split('\n')
          .flatMap((line, i) => (PX_TEXT.test(line) ? [`${repoRelative(file)}:${i + 1}`] : []))
      );
    expect(hits).toEqual([]);
  });

  it('leaves text fields to the global bidi rule, without dir="auto"', () => {
    // An empty field with dir="auto" resolves to LTR, so in an Arabic UI the caret
    // starts on the left and jumps on the first letter. `unicode-bidi: plaintext`
    // in global.css follows the text and leaves an empty field in the UI direction.
    const hits = listSourceFiles([ROOT])
      .filter((file) => file.endsWith('.svelte'))
      .flatMap((file) =>
        /<(textarea|input)\b[^>]*\sdir="auto"/.test(readFileSync(file, 'utf-8'))
          ? [repoRelative(file)]
          : []
      );
    expect(hits).toEqual([]);
  });

  it('lets the user show every password field (no fixed type="password")', () => {
    // A fixed type="password" has no eye button, so a typo stays hidden until
    // the server rejects the password (2FA off, change password, delete account
    // and the web app lock lacked it until 2026-11-22). Use
    // type={showX ? 'text' : 'password'} with an Eye / EyeOff button labelled
    // auth.unlock.show_password / hide_password and aria-pressed.
    const hits = listSourceFiles([ROOT])
      .filter((file) => file.endsWith('.svelte'))
      .flatMap((file) =>
        readFileSync(file, 'utf-8')
          .split('\n')
          .flatMap((line, i) =>
            /\btype="password"/.test(line) ? [`${repoRelative(file)}:${i + 1}`] : []
          )
      );
    expect(hits).toEqual([]);
  });

  it('gives an isolated numeric date the UI direction (<bdi dir={$textDirection}>, #542)', () => {
    // A date from the user's date format is digits and punctuation only. A bare
    // <bdi> finds no letter to take a direction from and falls back to LTR, so
    // in an Arabic UI "2026-11-13, 14:32" keeps the time on the right, where a
    // right-to-left reader starts: time first, date second.
    const BARE_BDI_DATE =
      /<bdi(?![^>]*\sdir=)[^>]*>\s*\{format(SettingsDateTime|DateWithSetting|Date)\(/;
    const hits = listSourceFiles([ROOT])
      .filter((file) => file.endsWith('.svelte'))
      .flatMap((file) =>
        readFileSync(file, 'utf-8')
          .split('\n')
          .flatMap((line, i) => (BARE_BDI_DATE.test(line) ? [`${repoRelative(file)}:${i + 1}`] : []))
      );
    expect(hits).toEqual([]);
  });

  it('formats a time of day on the clock the user chose (12h/24h setting, #581)', () => {
    // `Intl` takes the clock from the language: English and Arabic print
    // "5:13 PM" to a user who chose 24h. Use formatDateTime / formatTimeOfDay
    // from @reborn/i18n with the `timeFormat` store (or pass `hourCycle:
    // hourCycleFor(...)` to a formatter). `toLocaleString()` is flagged too: on
    // a date it prints the time, and numbers have formatNumber. Deliberately on
    // the language's clock: `time-format-ignore: <reason>` on the line above.
    const NEEDS_CLOCK = /timeStyle|\bhour:\s*['"]/;
    const hits = listSourceFiles([ROOT])
      .filter((file) => /\.(svelte|ts)$/.test(file) && !/\.(spec|test)\.ts$/.test(file))
      .flatMap((file) => {
        const lines = readFileSync(file, 'utf-8').split('\n');
        return lines.flatMap((line, i) => {
          const near = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
          const bad =
            /\.toLocale(Time)?String\(/.test(line) ||
            (NEEDS_CLOCK.test(line) && !/formatDateTime\(|hourCycle/.test(near));
          const ignored = /time-format-ignore: \S/.test(lines[i - 1] ?? '');
          return bad && !ignored ? [`${repoRelative(file)}:${i + 1}`] : [];
        });
      });
    expect(hits).toEqual([]);
  });

  it('shows a date in the format the user chose (date format setting, #595)', () => {
    // `Intl` takes the shape of a date from the language ("Nov 17, 2026",
    // "17.11.2026"), not from Settings > Appearance > Date format. A date or a
    // timestamp shown to the signed-in user goes through formatSettingsDateTime
    // (date + time) or formatDateWithSetting from @reborn/utils (date alone);
    // formatTimeOfDay is fine for a time alone. Deliberately in the style of
    // the language (a page for visitors without settings, a sentence in a
    // notification, text written into a file or a note):
    // `date-format-ignore: <reason>` within the five lines above.
    // Exempt: the formatter of periodic note titles, which has its own format
    // setting with month names (Settings > Periodic notes).
    const EXEMPT = ['/lib/services/periodic-notes-format.ts'];
    const LANGUAGE_DATE = /\.toLocaleDateString\(|dateStyle|\bformatDateTime\(|\b(year|month):\s*['"]/;
    const hits = listSourceFiles([ROOT])
      .filter((file) => /\.(svelte|ts)$/.test(file) && !/\.(spec|test)\.ts$/.test(file))
      .filter((file) => !EXEMPT.some((suffix) => file.endsWith(suffix)))
      .flatMap((file) => {
        const lines = readFileSync(file, 'utf-8').split('\n');
        return lines.flatMap((line, i) => {
          const above = lines.slice(Math.max(0, i - 5), i).join('\n');
          const ignored = /date-format-ignore: \S/.test(above);
          return LANGUAGE_DATE.test(line) && !ignored ? [`${repoRelative(file)}:${i + 1}`] : [];
        });
      });
    expect(hits).toEqual([]);
  });
});
