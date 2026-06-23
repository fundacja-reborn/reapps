/**
 * Release-notes ("What's new") selectors - manifest + pure filtering.
 *
 * Everything here is synchronous and depends only on the language-neutral
 * manifest. The async, locale-aware loader lives in `../release-notes-api.ts`
 * (kept at the package root so its dynamic `import()` path resolves the same way
 * from `src/` during tests and from the bundled `dist/index.js` at runtime).
 */
import manifestData from './manifest.json';
import type {
  LocalizedRelease,
  LocalizedReleaseItem,
  ReleaseApp,
  ReleaseEntry,
  ReleaseItem,
  ReleaseNotesText,
  ReleasePlatform
} from './types';

export * from './types';

/** Curated release history, newest first. */
export const RELEASE_NOTES: ReleaseEntry[] = manifestData as unknown as ReleaseEntry[];

/**
 * Numeric x.y.z comparison. Returns >0 when a > b, <0 when a < b, 0 when equal.
 * No pre-release suffixes are used on 0.x (guideline 38), so a plain segment
 * compare is sufficient.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Visibility predicate. `webSeesAll` widens the web/PWA surface to the FULL
 * catalog (including native-only items) so PWA users discover that native apps
 * exist; native builds always see only their own platform + universal items.
 * Display (`selectReleases`) passes it; the auto-open trigger does NOT, so a
 * native-only release never pops a modal at web users - it just appears in the
 * dialog once they open it.
 */
function itemMatches(
  item: ReleaseItem,
  app: ReleaseApp,
  platform: ReleasePlatform,
  webSeesAll = false
): boolean {
  if (!item.apps.includes(app)) return false;
  if (webSeesAll && platform === 'web') return true;
  if (item.platforms === 'all') return true;
  return item.platforms.includes(platform);
}

export interface ReleaseFilter {
  app: ReleaseApp;
  platform: ReleasePlatform;
}

/** Highest version present in the manifest. */
export function getLatestReleaseVersion(): string {
  return RELEASE_NOTES.reduce(
    (max, r) => (compareVersions(r.version, max) > 0 ? r.version : max),
    '0.0.0'
  );
}

/**
 * Whether at least one release in the (lastSeenVersion, currentVersion] window
 * carries an item relevant to this app + platform. Manifest-only (no text load)
 * so it is cheap enough to run on every startup to decide the post-update toast.
 */
export function hasUnseenReleaseNotes(
  opts: ReleaseFilter & { lastSeenVersion: string; currentVersion: string }
): boolean {
  const { app, platform, lastSeenVersion, currentVersion } = opts;
  return RELEASE_NOTES.some(
    (r) =>
      compareVersions(r.version, lastSeenVersion) > 0 &&
      compareVersions(r.version, currentVersion) <= 0 &&
      r.items.some((i) => itemMatches(i, app, platform))
  );
}

/**
 * Pure join + filter: given already-loaded localized text, return releases
 * (newest first) keeping only items relevant to this app + platform, optionally
 * capped at `untilVersion` (defends a frozen native bundle from ever rendering
 * notes newer than itself). Releases left with no items are dropped; an item
 * with no text for the locale is skipped (the integrity test guarantees full
 * coverage, so this is belt-and-suspenders).
 */
export function selectReleases(
  text: ReleaseNotesText,
  opts: ReleaseFilter & { untilVersion?: string }
): LocalizedRelease[] {
  const { app, platform, untilVersion } = opts;
  const out: LocalizedRelease[] = [];
  for (const release of RELEASE_NOTES) {
    if (untilVersion && compareVersions(release.version, untilVersion) > 0) continue;
    const items: LocalizedReleaseItem[] = [];
    for (const item of release.items) {
      if (!itemMatches(item, app, platform, true)) continue;
      const localized = text[item.id];
      if (!localized) continue;
      items.push({ ...item, text: localized });
    }
    if (items.length > 0) out.push({ version: release.version, date: release.date, items });
  }
  return out;
}
