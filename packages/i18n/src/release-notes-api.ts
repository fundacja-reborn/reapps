/**
 * Async, locale-aware entry point for release notes.
 *
 * This file lives at the package root (not under `release-notes/`) on purpose:
 * its dynamic `import()` path is resolved relative to the module's own location,
 * which is `src/` during tests and the bundled `dist/index.js` at runtime. A
 * root-relative `./release-notes/text/<locale>.json` therefore resolves
 * correctly in both - the same trick `setup.ts` uses for translations, which is
 * why the build copies `release-notes/text` into `dist/` (tsup keeps the
 * variable template `import()` as a runtime import rather than inlining it).
 */
import { selectReleases, selectUpcoming } from './release-notes';
import type {
  LocalizedRelease,
  LocalizedUpcomingItem,
  ReleaseApp,
  ReleaseNotesText,
  ReleasePlatform
} from './release-notes';
import type { SupportedLocale } from './config';

async function loadReleaseNotesText(locale: SupportedLocale): Promise<ReleaseNotesText> {
  try {
    const mod = await import(`./release-notes/text/${locale}.json`);
    return (mod.default ?? mod) as ReleaseNotesText;
  } catch {
    // Fall back to English if a locale file is missing. Use a variable in the
    // template so the bundler treats it as a runtime import too (not inlined).
    const fallback: SupportedLocale = 'en';
    const mod = await import(`./release-notes/text/${fallback}.json`);
    return (mod.default ?? mod) as ReleaseNotesText;
  }
}

/**
 * Load the localized "What's new" entries for a surface: filtered to the given
 * app + platform, newest first, optionally capped at `untilVersion`.
 */
export async function getReleaseNotes(opts: {
  app: ReleaseApp;
  platform: ReleasePlatform;
  locale: SupportedLocale;
  untilVersion?: string;
}): Promise<LocalizedRelease[]> {
  const text = await loadReleaseNotesText(opts.locale);
  return selectReleases(text, {
    app: opts.app,
    platform: opts.platform,
    untilVersion: opts.untilVersion
  });
}

/**
 * Load the localized "coming soon" items for a surface (web/PWA only; native
 * returns none). Independent of the released history and its version gating.
 */
export async function getUpcoming(opts: {
  app: ReleaseApp;
  platform: ReleasePlatform;
  locale: SupportedLocale;
}): Promise<LocalizedUpcomingItem[]> {
  const text = await loadReleaseNotesText(opts.locale);
  return selectUpcoming(text, { app: opts.app, platform: opts.platform });
}
