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
 * runs them whenever apps/reborn-task/src changes.
 */
const ROOT = 'apps/reborn-task/src';

describe('UI source guards (apps/reborn-task/src)', () => {
  it('uses logical direction utilities, not physical ones (RTL)', () => {
    // Fix: `node scripts/check-rtl-direction.mjs --fix apps/reborn-task/src`, or mark a
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

  it('asks only for translation keys that exist ($t("...") in common + tasks)', () => {
    // A missing key renders as the key itself: an empty field in the security
    // settings asked for "auth.validation.required", which no locale had
    // (found 2026-11-22). Locale parity can't see it, the key is missing in all
    // six files alike. Fix: add the key to every locale (or use an existing one).
    const sources = listSourceFiles([ROOT])
      .filter((file) => /\.(svelte|ts)$/.test(file) && !/\.(spec|test)\.ts$/.test(file))
      .map((file) => ({ path: repoRelative(file), text: readFileSync(file, 'utf-8') }));
    // The catalogs this app loads (i18n.store: apps ['common', 'tasks']).
    expect(missingKeyRefs(sources, appRuntimeKeys(['common', 'tasks/']))).toEqual([]);
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

  it('never shows server text or a hardcoded error text (guideline 02)', () => {
    // The server's `error` / `message` is English text for logs: map it to a
    // translation (authErrorKey from @reborn/auth for the auth routes, the
    // action's own text otherwise). An error set to a literal (error = 'Login
    // failed', a Polish template) reads the same in every language.
    const RAW_SERVER_TEXT = /\b(?:data|body|result|res)\??\.(?:error|message)\s*(?:\|\||\?\?)/;
    const LITERAL_ERROR = /\b\w*[eE]rror(?:Message)?\s*=\s*['"`][A-Z]/;
    const hits = listSourceFiles([ROOT])
      .filter((file) => file.endsWith('.svelte'))
      .flatMap((file) =>
        readFileSync(file, 'utf-8')
          .split('\n')
          .flatMap((line, i) =>
            RAW_SERVER_TEXT.test(line) || LITERAL_ERROR.test(line)
              ? [`${repoRelative(file)}:${i + 1}`]
              : []
          )
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
    const LANGUAGE_DATE = /\.toLocaleDateString\(|dateStyle|\bformatDateTime\(|\b(year|month):\s*['"]/;
    const hits = listSourceFiles([ROOT])
      .filter((file) => /\.(svelte|ts)$/.test(file) && !/\.(spec|test)\.ts$/.test(file))
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

  it('never resolves a promise with a Capacitor plugin object', () => {
    // A Capacitor plugin is a Proxy that answers every property with a native
    // method wrapper, `then` included. Returned from an async function (or
    // passed to resolve / a `.then` callback's return), the promise machinery
    // calls `plugin.then(...)` - a native call that never settles, so the await
    // hangs silently. Found 2026-11-28 in native-reminders.ts: the permission
    // button greyed out forever and no reminder was ever planned. Return the
    // module (`import('@capacitor/x')`) and take the plugin out at the call.
    const PLUGIN_IMPORT =
      /(?:import|const)\s*\{([^}]+)\}\s*(?:from|=\s*await\s+import\()\s*['"]@(?:capacitor|aparajita)\/(?!core|cli)[^'"]+['"]/g;
    const hits = listSourceFiles([ROOT])
      .filter((file) => /\.(svelte|ts)$/.test(file) && !/\.(spec|test)\.ts$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf-8');
        const names = [...source.matchAll(PLUGIN_IMPORT)].flatMap((m) =>
          m[1]
            .split(',')
            .map((part) => part.trim().split(/\s+as\s+/).pop() ?? '')
            .filter((name) => /^[A-Z]\w*$/.test(name))
        );
        return names.flatMap((name) => {
          const returned = new RegExp(`(?:return|resolve\\()\\s*${name}\\s*[;)]`);
          return returned.test(source) ? [`${repoRelative(file)}: ${name}`] : [];
        });
      });
    expect(hits).toEqual([]);
  });
});
