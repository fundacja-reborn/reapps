#!/usr/bin/env node
/**
 * Export strings for a translator as one JSON file: for every string its key,
 * the English source, the current translation (a draft, or empty) and where it
 * appears in the app, plus its placeholders and plural forms. The translator
 * edits only the translation field and sends the file back; i18n-import.mjs
 * validates it and writes it into the locale files. No pull request, no
 * translation platform, no repository access (Arabic plan, Phase 3).
 *
 * Usage (from the repo root):
 *   node scripts/i18n-export.mjs --locale=ar --summary
 *       strings and words per area, to plan the batches
 *   node scripts/i18n-export.mjs --locale=ar --catalog=notes,common --prefix=auth.,e2e. --out=tmp/i18n/ar-01-auth.json
 *
 * Options:
 *   --locale=<code>      target locale (required)
 *   --catalog=<ids>      notes, common, tasks (all task files) or tasks/<file>,
 *                        release-notes; default: all
 *   --prefix=<prefixes>  only keys starting with one of these (`auth.`), or
 *                        qualified (`notes:auth.`)
 *   --only=missing       only strings the locale does not have yet
 *   --only=unreviewed    only strings a translator has not reviewed in their
 *                        current form: draft, stale or edited (i18n-review.mjs;
 *                        the locale must be tracked). The round before a release.
 *   --referenced         only strings some source file refers to (most of
 *                        the rest are unused keys)
 *   --out=<file>         output file (default: stdout)
 *   --summary            print strings and words per area instead
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSourceFiles, repoRelative } from './check-rtl-direction.mjs';
import {
  REPO_PATHS,
  SOURCE_LOCALE,
  analyzeMessage,
  describeArguments,
  listCatalogs,
  pluralCategories,
  readCatalog
} from './i18n-messages.mjs';
import { readReview, stringStatus } from './i18n-review.mjs';

const { REPO_ROOT } = REPO_PATHS;

export const TRANSFER_FORMAT = 'reborn-i18n-transfer';
export const TRANSFER_VERSION = 1;
const MAX_WHERE = 5;

// ---------------------------------------------------------------------------
// Where a key appears
// ---------------------------------------------------------------------------

// A key written out in full ('auth.unlock.title'), and the literal start of a
// key built in code: `notes.periodic.${type}.placeholder`,
// `whats_new.category_${category}` or 'settings.' + section.
const KEY_LITERAL = /(['"`])([A-Za-z_][\w-]*(?:\.[\w-]+)+)\1/g;
const KEY_TEMPLATE_PREFIX = /`([A-Za-z_][\w-]*\.[\w.-]*)\$\{/g;
const KEY_CONCAT_PREFIX = /(['"])([A-Za-z_][\w-]*\.[\w.-]*)\1\s*\+/g;

// Both apps and every package. Translation JSON is not scanned (not a source
// extension), so a key never counts as referenced by itself.
const USAGE_ROOTS = [
  'apps/reborn-notes/src',
  'apps/reborn-task/src',
  ...readdirSync(resolve(REPO_ROOT, 'packages'))
    .map((pkg) => `packages/${pkg}/src`)
    .filter((dir) => existsSync(resolve(REPO_ROOT, dir)))
];

/** Scan app and package sources once for translation-key references. */
export function scanKeyUsage(files = listSourceFiles(USAGE_ROOTS)) {
  const exact = new Map();
  const dynamic = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = repoRelative(file);
    for (const m of text.matchAll(KEY_LITERAL)) {
      if (!exact.has(m[2])) exact.set(m[2], new Set());
      exact.get(m[2]).add(rel);
    }
    for (const m of text.matchAll(KEY_TEMPLATE_PREFIX)) dynamic.push({ prefix: m[1], file: rel });
    for (const m of text.matchAll(KEY_CONCAT_PREFIX)) dynamic.push({ prefix: m[2], file: rel });
  }
  return { exact, dynamic };
}

/** Source files that use a runtime key; `dynamic` when only a built-key prefix matched. */
export function findUsage(runtimeKey, usage) {
  const exact = usage.exact.get(runtimeKey);
  if (exact) return { files: [...exact].sort(), dynamic: false };
  const files = new Set(
    usage.dynamic.filter((d) => runtimeKey.startsWith(d.prefix)).map((d) => d.file)
  );
  return { files: [...files].sort(), dynamic: files.size > 0 };
}

function describeWhere(catalog, key, usage) {
  if (catalog.syntax === 'plain') return ["What's new dialog (release notes)"];
  const { files, dynamic } = findUsage(catalog.runtimeKey(key), usage);
  if (files.length === 0) return [];
  const shown = files.slice(0, MAX_WHERE).map((f) => (dynamic ? `${f} (key built in code)` : f));
  if (files.length > MAX_WHERE) shown.push(`+${files.length - MAX_WHERE} more`);
  return shown;
}

// ---------------------------------------------------------------------------
// Export document
// ---------------------------------------------------------------------------

function selectCatalogs(ids) {
  const all = listCatalogs();
  if (!ids?.length) return all;
  const unknown = ids.filter((id) => !all.some((c) => c.id === id || c.id.startsWith(`${id}/`)));
  if (unknown.length) throw new Error(`Unknown catalog: ${unknown.join(', ')}`);
  return all.filter((c) => ids.some((id) => c.id === id || c.id.startsWith(`${id}/`)));
}

function matchesPrefix(catalog, key, prefixes) {
  if (!prefixes?.length) return true;
  const qualified = `${catalog.id}:${key}`;
  return prefixes.some((p) => key.startsWith(p) || qualified.startsWith(p));
}

function hints(en, locale, syntax) {
  if (syntax !== 'icu' || typeof en !== 'string') return {};
  const analysis = analyzeMessage(en);
  if (analysis.error) return {};
  const out = {};
  const placeholders = describeArguments(en);
  if (placeholders.length) out.placeholders = placeholders;
  const plural = analysis.choices
    .filter((c) => c.kind !== 'select')
    .map((c) => `{${c.name}}: ${pluralCategories(locale, c.kind).join(', ')}`);
  if (plural.length) out.plural = [...new Set(plural)];
  const select = analysis.choices
    .filter((c) => c.kind === 'select')
    .map((c) => `{${c.name}}: keep the option names ${c.options.join(', ')}`);
  if (select.length) out.select = [...new Set(select)];
  return out;
}

// Why a string the translator already reviewed is in the file again.
const REVIEW_NOTES = {
  stale: 'The English changed after your last review.',
  edited: 'We changed this translation after your last review.'
};

export function instructions(locale, { reviewNotes = false } = {}) {
  return [
    `Edit only the "${locale}" value of each entry. Leave "key", "en" and the other fields unchanged.`,
    'Keep placeholders such as {count} or {name} exactly as in English; they are replaced by the app.',
    `"plural" lists the forms a message needs in this language. Example: {count, plural, zero {...} one {...} two {...} few {# ...} many {# ...} other {# ...}}, where # is the number.`,
    'Write quotes as "...", «...» or „...", never with apostrophes around a placeholder.',
    'Entries with "where" empty are not referenced directly in the code (for example built from parts).',
    'You can add a "comment" field to any entry for questions or remarks.',
    ...(reviewNotes ? ['"review" says why a string you checked before is here again.'] : []),
    'Every entry in the file you send back counts as reviewed, also the ones you left unchanged. Delete the entries you did not get to.'
  ];
}

/**
 * Build the export document.
 * `referenced` leaves out strings no source file refers to: most are unused,
 * and the translator's time goes to what users see. For a tracked locale
 * (i18n-review.mjs) a string that was reviewed but changed since carries a
 * "review" note; `only: 'unreviewed'` keeps just the strings needing review.
 * @param {{ locale: string, catalogs?: string[], prefixes?: string[], only?: 'all' | 'missing' | 'unreviewed', referenced?: boolean, usage?: ReturnType<typeof scanKeyUsage>, date?: string, read?: typeof readCatalog, review?: ReturnType<typeof readReview> }} options
 */
export function buildExport({
  locale,
  catalogs,
  prefixes,
  only = 'all',
  referenced = false,
  usage,
  date,
  read = readCatalog,
  review = readReview(locale)
}) {
  if (!locale || locale === SOURCE_LOCALE)
    throw new Error('--locale must be a target locale, not en');
  if (only === 'unreviewed' && !review)
    throw new Error(
      `${locale} has no review file, so nothing says what is reviewed (i18n-review.mjs --init)`
    );
  const keyUsage = usage ?? scanKeyUsage();
  const strings = [];
  for (const catalog of selectCatalogs(catalogs)) {
    const source = read(catalog, SOURCE_LOCALE);
    const current = read(catalog, locale) ?? new Map();
    for (const [key, en] of source) {
      if (!matchesPrefix(catalog, key, prefixes)) continue;
      const existing = current.get(key);
      if (only === 'missing' && existing !== undefined) continue;
      const qualified = `${catalog.id}:${key}`;
      const status = review ? stringStatus(review.reviewed.get(qualified), en, existing) : null;
      if (only === 'unreviewed' && status === 'reviewed') continue;
      const where = describeWhere(catalog, key, keyUsage);
      if (referenced && where.length === 0) continue;
      strings.push({
        key: qualified,
        en,
        [locale]: existing ?? (Array.isArray(en) ? en.map(() => '') : ''),
        ...(REVIEW_NOTES[status] ? { review: REVIEW_NOTES[status] } : {}),
        where,
        ...hints(en, locale, catalog.syntax)
      });
    }
  }
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    locale,
    exported: date ?? new Date().toISOString().slice(0, 10),
    instructions: instructions(locale, { reviewNotes: strings.some((s) => s.review) }),
    strings
  };
}

const countWords = (value) =>
  (Array.isArray(value) ? value.join(' ') : String(value))
    .split(/\s+/u)
    .filter((w) => /\p{L}/u.test(w)).length;

/** Strings and English words per area (catalog + top-level key), to plan batches. */
export function summarize({ locale, catalogs, read = readCatalog }) {
  const rows = new Map();
  for (const catalog of selectCatalogs(catalogs)) {
    const current = read(catalog, locale) ?? new Map();
    for (const [key, en] of read(catalog, SOURCE_LOCALE)) {
      const area = catalog.syntax === 'plain' ? catalog.id : `${catalog.id}:${key.split('.')[0]}`;
      const row = rows.get(area) ?? { area, strings: 0, words: 0, missing: 0 };
      row.strings += 1;
      row.words += countWords(en);
      if (!current.has(key)) row.missing += 1;
      rows.set(area, row);
    }
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`Unexpected argument: ${arg}`);
    opts[m[1]] = m[2] ?? true;
  }
  const list = (v) =>
    typeof v === 'string'
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  return { ...opts, catalog: list(opts.catalog), prefix: list(opts.prefix) };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (typeof opts.locale !== 'string') throw new Error('--locale=<code> is required');
    if (opts.summary) {
      const rows = summarize({ locale: opts.locale, catalogs: opts.catalog });
      for (const r of rows)
        console.log(
          `${r.area.padEnd(48)} ${String(r.strings).padStart(5)} strings ${String(r.words).padStart(6)} words  missing ${r.missing}`
        );
      const total = rows.reduce(
        (t, r) => ({ s: t.s + r.strings, w: t.w + r.words, m: t.m + r.missing }),
        { s: 0, w: 0, m: 0 }
      );
      console.log(
        `${'TOTAL'.padEnd(48)} ${String(total.s).padStart(5)} strings ${String(total.w).padStart(6)} words  missing ${total.m}`
      );
    } else {
      if (opts.only && !['all', 'missing', 'unreviewed'].includes(opts.only))
        throw new Error('--only must be all, missing or unreviewed');
      const doc = buildExport({
        locale: opts.locale,
        catalogs: opts.catalog,
        prefixes: opts.prefix,
        only: opts.only,
        referenced: opts.referenced === true
      });
      const json = `${JSON.stringify(doc, null, 2)}\n`;
      if (typeof opts.out === 'string') {
        mkdirSync(dirname(resolve(opts.out)), { recursive: true });
        writeFileSync(opts.out, json);
        const unreferenced = doc.strings.filter((s) => s.where.length === 0).length;
        console.error(
          `i18n-export: ${doc.strings.length} strings -> ${opts.out} (${unreferenced} without a code reference)`
        );
      } else {
        process.stdout.write(json);
      }
    }
  } catch (error) {
    console.error(`i18n-export: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
