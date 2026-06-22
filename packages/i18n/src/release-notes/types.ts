/**
 * Release-notes ("What's new") data model.
 *
 * This is curated, user-facing content - deliberately separate from the
 * auto-generated, technical CHANGELOG.md. The same dataset feeds two surfaces:
 *   - the in-app "What's new" dialog (filtered to the current app + platform)
 *   - the public /changelog page on the website (full, unfiltered, with badges)
 *
 * Structure (language-neutral: version / date / tags) lives in `manifest.json`;
 * the human text - a single user-facing sentence or two per item - lives
 * per-locale in `text/<locale>.json`, keyed by the stable item `id`. A Vitest
 * integrity test enforces that every id has text in all 5 locales and that tags
 * use valid enum values.
 */

/** Which app(s) an item is relevant to. The monorepo ships one version, but
 *  features are per-app, so the in-app dialog filters by the running app. */
export type ReleaseApp = 'notes' | 'task';

/** Platforms an item applies to. `'all'` is the common case (web + every native
 *  target). Narrow tags hide platform-specific items from users who can't see
 *  them - e.g. a native-only feature never shows to a web user, and vice versa.
 *  Desktop targets are listed ahead of shipping so the data is ready for them. */
export type ReleasePlatform = 'web' | 'android' | 'ios' | 'macos' | 'windows' | 'linux';

export type ReleaseCategory = 'new' | 'improved' | 'fixed';

export interface ReleaseItem {
  /** Stable, unique id, e.g. "0.34.0-linked-notes". Used as the i18n text key. */
  id: string;
  category: ReleaseCategory;
  apps: ReleaseApp[];
  /** `'all'` or an explicit list of platforms. */
  platforms: ReleasePlatform[] | 'all';
}

export interface ReleaseEntry {
  /** Monorepo version, same axis as `__APP_VERSION__`, e.g. "0.34.0". */
  version: string;
  /** ISO date, "YYYY-MM-DD". */
  date: string;
  items: ReleaseItem[];
}

/**
 * Per-locale text for a single item, keyed by item id in `text/<locale>.json`.
 * One self-contained description per item (no separate title): the "What's new"
 * dialog and the public changelog both render it as a single bullet line.
 */
export type ReleaseNotesText = Record<string, string>;

/** An item joined with its localized text, ready to render. */
export type LocalizedReleaseItem = ReleaseItem & { text: string };

export interface LocalizedRelease {
  version: string;
  date: string;
  items: LocalizedReleaseItem[];
}
