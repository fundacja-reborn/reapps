#!/usr/bin/env node
/**
 * Review queue for locales a translator checks (Arabic plan, Phase 4).
 *
 * packages/i18n/review/<locale>.json lists the strings a translator has
 * reviewed: qualified key (`notes:auth.unlock.title`) -> short hashes of the
 * English source and of the translation at the time of the review. Every other
 * string of the locale is a draft (written by us, for example for a new key).
 * A locale is tracked only when its review file exists. The file sits outside
 * src/translations on purpose: the apps load translations through a dynamic
 * import that Vite turns into a glob over `translations/<dir>/<file>.json`, so a
 * file there would be built into the apps.
 *
 * Status of a string, computed from the current locale files:
 *   reviewed  the translator saw exactly this English and exactly this translation
 *   stale     the English changed after the review
 *   edited    same English, but the translation changed after the review (our fix
 *             or update, which the translator has not seen)
 *   draft     never reviewed
 *
 * i18n-import --write records every entry it imports as reviewed, whether the
 * translator changed it or left it as it was (stale and invalid entries are not
 * imported). i18n-export --only=unreviewed exports draft, stale and edited
 * strings: the translator's round before a release. check-i18n-parity prints the
 * counts for information; it fails only on a malformed review file.
 *
 * Usage (from the repo root):
 *   node scripts/i18n-review.mjs --locale=ar                   counts per catalog
 *   node scripts/i18n-review.mjs --locale=ar --list=stale,edited
 *   node scripts/i18n-review.mjs --locale=ar --prune           drop keys English no longer has
 *   node scripts/i18n-review.mjs --locale=xx --init            start tracking a locale
 *
 * Exit code: 0 = ok, 2 = bad usage or a malformed review file.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_PATHS, SOURCE_LOCALE, listCatalogs, readCatalog } from './i18n-messages.mjs';

export const REVIEW_FORMAT = 'reborn-i18n-review';
export const REVIEW_VERSION = 1;
export const REVIEW_DIR = join(REPO_PATHS.REPO_ROOT, 'packages', 'i18n', 'review');
export const REVIEW_STATUSES = ['reviewed', 'stale', 'edited', 'draft'];

const HASH = /^[0-9a-f]{12}$/;
const ABOUT =
  'Strings a translator has reviewed: hashes of the English source and of the translation ' +
  'at review time. Strings not listed are drafts. Written by scripts/i18n-import.mjs --write; ' +
  'see scripts/i18n-review.mjs.';

export const reviewPath = (locale, dir = REVIEW_DIR) => join(dir, `${locale}.json`);

/** Short, stable fingerprint of a message (string or list of strings). Not a secret. */
export function hashMessage(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

/** Locales that have a review file, i.e. are reviewed by a translator. */
export function trackedLocales(dir = REVIEW_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[a-z]{2,3}\.json$/.test(f))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/**
 * Parse the text of a review file. Throws on anything malformed, so a broken
 * file fails loudly instead of turning every string back into a draft.
 * @returns {{ locale: string, reviewed: Map<string, { en: string, text: string }> }}
 */
export function parseReview(text, locale) {
  const fail = (message) => {
    throw new Error(`review file for ${locale}: ${message}`);
  };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON (${error instanceof Error ? error.message : error})`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('not a JSON object');
  if (doc.format !== REVIEW_FORMAT) fail(`"format" must be "${REVIEW_FORMAT}"`);
  if (doc.version !== REVIEW_VERSION) fail(`"version" must be ${REVIEW_VERSION}`);
  if (doc.locale !== locale) fail(`"locale" must be "${locale}"`);
  const entries = doc.reviewed;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries))
    fail('"reviewed" must be an object');
  const reviewed = new Map();
  for (const [key, entry] of Object.entries(entries)) {
    if (!/^[^:\s]+:\S+$/.test(key)) fail(`"${key}" is not a catalog:key`);
    if (!HASH.test(entry?.en) || !HASH.test(entry?.[locale]))
      fail(`"${key}" needs "en" and "${locale}" hashes (12 hex characters)`);
    reviewed.set(key, { en: entry.en, text: entry[locale] });
  }
  return { locale, reviewed };
}

/** The review state of a locale, or null when the locale is not tracked. */
export function readReview(locale, dir = REVIEW_DIR) {
  const path = reviewPath(locale, dir);
  if (!existsSync(path)) return null;
  return parseReview(readFileSync(path, 'utf8'), locale);
}

/** Every source key as `catalog:key`, in catalog order and English key order. */
export function sourceKeys({ read = readCatalog, catalogs = listCatalogs() } = {}) {
  const keys = [];
  for (const catalog of catalogs)
    for (const key of read(catalog, SOURCE_LOCALE)?.keys() ?? []) keys.push(`${catalog.id}:${key}`);
  return keys;
}

/**
 * Review file text: entries in `order` (source order, for small diffs), one per
 * line. Entries whose key is not in `order` are left out.
 */
export function serializeReview(locale, reviewed, order) {
  const lines = order
    .filter((key) => reviewed.has(key))
    .map((key) => {
      const { en, text } = reviewed.get(key);
      return `    ${JSON.stringify(key)}: { "en": "${en}", ${JSON.stringify(locale)}: "${text}" }`;
    });
  return [
    '{',
    `  "format": "${REVIEW_FORMAT}",`,
    `  "version": ${REVIEW_VERSION},`,
    `  "locale": ${JSON.stringify(locale)},`,
    `  "about": ${JSON.stringify(ABOUT)},`,
    lines.length ? `  "reviewed": {\n${lines.join(',\n')}\n  }` : '  "reviewed": {}',
    '}',
    ''
  ].join('\n');
}

/**
 * Write a locale's review file in source order. Keys English no longer has are
 * dropped. Returns how many entries were written and dropped.
 * @param {string} locale
 * @param {Map<string, { en: string, text: string }>} reviewed
 */
export function writeReview(locale, reviewed, { read = readCatalog, dir = REVIEW_DIR } = {}) {
  const order = sourceKeys({ read });
  const known = new Set(order);
  const path = reviewPath(locale, dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeReview(locale, reviewed, order));
  const dropped = [...reviewed.keys()].filter((k) => !known.has(k)).length;
  return { written: reviewed.size - dropped, dropped };
}

/**
 * Add review records for strings the translator has seen.
 * @param {Map<string, { en: string, text: string }>} reviewed current records
 * @param {{ key: string, en: unknown, text: unknown }[]} items qualified key, English and translation as reviewed
 */
export function recordReviewed(reviewed, items) {
  const next = new Map(reviewed);
  for (const { key, en, text } of items)
    next.set(key, { en: hashMessage(en), text: hashMessage(text) });
  return next;
}

/**
 * Status of one string from its review record and the current texts.
 * @returns {'reviewed' | 'stale' | 'edited' | 'draft'}
 */
export function stringStatus(record, en, text) {
  if (!record || text === undefined) return 'draft';
  if (record.en !== hashMessage(en)) return 'stale';
  if (record.text !== hashMessage(text)) return 'edited';
  return 'reviewed';
}

const emptyCounts = () => Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0]));

/**
 * Status of every string of a tracked locale, with counts overall and per
 * catalog, plus records whose key English no longer has (orphans).
 * @param {{ locale: string, review: { reviewed: Map<string, { en: string, text: string }> }, read?: typeof readCatalog, catalogs?: ReturnType<typeof listCatalogs> }} options
 */
export function reviewStatus({ locale, review, read = readCatalog, catalogs = listCatalogs() }) {
  const strings = [];
  const known = new Set();
  const counts = emptyCounts();
  const byCatalog = new Map();
  for (const catalog of catalogs) {
    const source = read(catalog, SOURCE_LOCALE);
    if (!source) continue;
    const target = read(catalog, locale) ?? new Map();
    const catalogCounts = emptyCounts();
    for (const [key, en] of source) {
      const qualified = `${catalog.id}:${key}`;
      known.add(qualified);
      const status = stringStatus(review.reviewed.get(qualified), en, target.get(key));
      strings.push({ key: qualified, status });
      counts[status] += 1;
      catalogCounts[status] += 1;
    }
    byCatalog.set(catalog.id, catalogCounts);
  }
  // Only records of the catalogs looked at (or of catalogs that no longer exist)
  // can be orphans; a partial check must not flag the others.
  const ids = new Set(catalogs.map((c) => c.id));
  const allIds = new Set(listCatalogs().map((c) => c.id));
  const orphans = [...review.reviewed.keys()].filter((key) => {
    const id = key.slice(0, key.indexOf(':'));
    return !known.has(key) && (ids.has(id) || !allIds.has(id));
  });
  return { strings, counts, byCatalog, orphans, total: strings.length };
}

export function formatCounts(counts, total) {
  return `reviewed ${counts.reviewed}/${total}, draft ${counts.draft}, stale ${counts.stale}, edited ${counts.edited}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`unexpected argument: ${arg}`);
    opts[m[1]] = m[2] ?? true;
  }
  if (typeof opts.locale !== 'string') throw new Error('--locale=<code> is required');
  if (opts.locale === SOURCE_LOCALE) throw new Error('en is the source locale, it has no review');
  if (opts.list !== undefined) {
    const list = String(opts.list).split(',').filter(Boolean);
    const unknown = list.filter((s) => !REVIEW_STATUSES.includes(s));
    if (!list.length || unknown.length)
      throw new Error(`--list takes ${REVIEW_STATUSES.join(', ')}`);
    opts.list = list;
  }
  return opts;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const { locale } = opts;
    let review = readReview(locale);
    if (opts.init) {
      if (review) throw new Error(`${locale} is already tracked (${reviewPath(locale)})`);
      writeReview(locale, new Map());
      console.log(`i18n-review: tracking ${locale}, created ${reviewPath(locale)}`);
      review = readReview(locale);
    }
    if (!review)
      throw new Error(`${locale} is not tracked: no ${reviewPath(locale)} (start with --init)`);
    const status = reviewStatus({ locale, review });
    if (opts.prune) {
      const { dropped } = writeReview(locale, review.reviewed);
      console.log(`i18n-review: dropped ${dropped} record(s) of keys English no longer has`);
    } else if (opts.list) {
      for (const s of status.strings)
        if (opts.list.includes(s.status)) console.log(`${s.status.padEnd(8)} ${s.key}`);
    } else {
      console.log(`i18n-review: ${locale}, ${formatCounts(status.counts, status.total)}`);
      for (const [id, counts] of status.byCatalog) {
        const total = REVIEW_STATUSES.reduce((n, s) => n + counts[s], 0);
        console.log(`  ${id.padEnd(28)} ${formatCounts(counts, total)}`);
      }
      if (status.orphans.length)
        console.log(
          `\n${status.orphans.length} record(s) of keys English no longer has (--prune drops them): ${status.orphans.slice(0, 10).join(', ')}`
        );
    }
  } catch (error) {
    console.error(`i18n-review: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
