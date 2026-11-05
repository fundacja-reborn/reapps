#!/usr/bin/env node
/**
 * Import a translator's file (made by i18n-export.mjs) into the locale files.
 *
 * Every entry is validated at the `import` level of i18n-messages.mjs (ICU
 * syntax, placeholders, all plural forms, no new links / markup, Western
 * digits, no bidi-override or invisible characters, no em-dash). Import is all
 * or nothing: one error and nothing is written. Entries whose English changed
 * since the export are skipped as stale and reported, so they stay as they are
 * (a draft) until the next round.
 *
 * The report lists every security-critical key the translator changed (see
 * CRITICAL_KEY_PREFIXES) with English and the new text, for the
 * back-translation check before the change is committed (Arabic plan, Phase 3).
 *
 * --write also records every imported entry, changed or left as it was, as
 * reviewed in packages/i18n/review/<locale>.json (i18n-review.mjs, Phase 4).
 *
 * Usage (from the repo root):
 *   node scripts/i18n-import.mjs tmp/i18n/ar-01-auth.returned.json            # dry run, report only
 *   node scripts/i18n-import.mjs tmp/i18n/ar-01-auth.returned.json --write    # write when there are no errors
 *   node scripts/i18n-import.mjs <file> --verbose                             # also list every changed key
 *
 * Exit code: 0 = no errors, 1 = validation errors (nothing written), 2 = bad usage or file.
 */
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSFER_FORMAT, TRANSFER_VERSION } from './i18n-export.mjs';
import { readReview, recordReviewed, reviewPath, writeReview } from './i18n-review.mjs';
import {
  REPO_PATHS,
  SOURCE_LOCALE,
  isCriticalKey,
  listCatalogs,
  readCatalog,
  validateMessage,
  writeCatalogChanges
} from './i18n-messages.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Structural problems of the document itself (wrong file, wrong format). */
function documentErrors(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    return ['the file is not a JSON object'];
  const errors = [];
  if (doc.format !== TRANSFER_FORMAT) errors.push(`"format" must be "${TRANSFER_FORMAT}"`);
  if (doc.version !== TRANSFER_VERSION) errors.push(`"version" must be ${TRANSFER_VERSION}`);
  if (typeof doc.locale !== 'string' || !/^[a-z]{2,3}$/.test(doc.locale))
    errors.push('"locale" must be a language code');
  else if (doc.locale === SOURCE_LOCALE) errors.push('cannot import into the source locale (en)');
  if (!Array.isArray(doc.strings)) errors.push('"strings" must be a list');
  return errors;
}

/**
 * Validate a returned file against the current catalogs and work out what an
 * import would change. Pure apart from reading catalogs through `read`.
 * @param {unknown} doc parsed JSON
 * @param {{ read?: typeof readCatalog }} [options]
 */
export function planImport(doc, { read = readCatalog } = {}) {
  const fatal = documentErrors(doc);
  if (fatal.length) {
    return {
      locale: null,
      results: [],
      fatal,
      errors: fatal.length,
      warnings: 0,
      updates: new Map(),
      reviewed: []
    };
  }
  const { locale } = doc;
  const catalogs = new Map(listCatalogs().map((c) => [c.id, c]));
  const cache = new Map();
  const load = (catalog, loc) => {
    const id = `${catalog.id}@${loc}`;
    if (!cache.has(id)) cache.set(id, read(catalog, loc));
    return cache.get(id);
  };

  const results = [];
  const updates = new Map();
  const reviewed = [];
  const seen = new Set();
  const missingFiles = new Set();

  doc.strings.forEach((entry, index) => {
    const key = typeof entry?.key === 'string' ? entry.key : `#${index + 1}`;
    const result = {
      key,
      status: 'invalid',
      issues: [],
      critical: false,
      comment: undefined,
      en: entry?.en,
      text: entry?.[locale]
    };
    results.push(result);
    const fail = (code, message) => result.issues.push({ level: 'error', code, message });

    if (typeof entry?.comment === 'string' && entry.comment.trim())
      result.comment = entry.comment.trim();
    if (typeof entry?.key !== 'string') return fail('bad-entry', 'entry has no "key"');
    if (seen.has(key)) return fail('duplicate', 'key appears more than once in the file');
    seen.add(key);

    const sep = key.indexOf(':');
    const catalog = catalogs.get(key.slice(0, sep));
    const messageKey = key.slice(sep + 1);
    if (sep < 0 || !catalog) return fail('unknown-key', 'unknown catalog in key');
    const source = load(catalog, SOURCE_LOCALE);
    if (!source.has(messageKey))
      return fail('unknown-key', 'key does not exist in English (removed or renamed?)');
    const target = load(catalog, locale);
    if (!target) {
      if (!missingFiles.has(catalog.id))
        fail(
          'missing-file',
          `no ${locale} file for ${catalog.id}: add the locale before importing`
        );
      missingFiles.add(catalog.id);
      return;
    }

    const en = source.get(messageKey);
    result.critical = isCriticalKey(key);
    if (!same(entry.en, en)) {
      result.status = 'stale';
      result.issues.push({
        level: 'warning',
        code: 'stale',
        message: 'English changed since the export; not imported, send it again'
      });
      return;
    }
    if (!(locale in entry)) return fail('bad-entry', `entry has no "${locale}" field`);

    const text = entry[locale];
    result.issues.push(
      ...validateMessage({ en, text, locale, syntax: catalog.syntax, mode: 'import' })
    );
    if (result.issues.some((i) => i.level === 'error')) return;

    // Left as it was or corrected: either way the translator has reviewed it.
    reviewed.push({ key, en, text });
    if (same(target.get(messageKey), text)) {
      result.status = 'unchanged';
      return;
    }
    result.status = 'changed';
    result.previous = target.get(messageKey);
    if (!updates.has(catalog.id)) updates.set(catalog.id, new Map());
    updates.get(catalog.id).set(messageKey, text);
  });

  const count = (level) =>
    results.reduce((n, r) => n + r.issues.filter((i) => i.level === level).length, 0);
  return {
    locale,
    results,
    fatal: [],
    errors: count('error'),
    warnings: count('warning'),
    updates,
    reviewed
  };
}

/**
 * Write a plan's changes into the locale files and record the imported entries
 * as reviewed. Refuses a plan with errors.
 */
export function applyImport(
  plan,
  {
    read = readCatalog,
    write = writeCatalogChanges,
    readReviewFile = readReview,
    writeReviewFile = writeReview
  } = {}
) {
  if (plan.errors > 0) throw new Error('refusing to write: the file has validation errors');
  const catalogs = new Map(listCatalogs().map((c) => [c.id, c]));
  for (const [id, changes] of plan.updates) {
    const catalog = catalogs.get(id);
    write(catalog, plan.locale, changes, read(catalog, SOURCE_LOCALE));
  }
  if (plan.reviewed.length) {
    const current = readReviewFile(plan.locale)?.reviewed ?? new Map();
    writeReviewFile(plan.locale, recordReviewed(current, plan.reviewed), { read });
  }
}

const show = (value) => (Array.isArray(value) ? value.join(' | ') : String(value ?? ''));

export function formatReport(plan, { verbose = false } = {}) {
  if (plan.fatal.length) return `i18n-import: not a transfer file:\n  ${plan.fatal.join('\n  ')}`;
  const by = (status) => plan.results.filter((r) => r.status === status);
  const lines = [
    `i18n-import: ${plan.locale}, ${plan.results.length} entries`,
    `  changed ${by('changed').length}, unchanged ${by('unchanged').length}, stale ${by('stale').length}, invalid ${by('invalid').length}`,
    `  errors ${plan.errors}, warnings ${plan.warnings}`,
    `  reviewed by the translator: ${plan.reviewed.length} (changed + unchanged, recorded on --write)`
  ];
  const section = (title, items) => {
    if (items.length) lines.push('', title, ...items);
  };
  const issues = (level) =>
    plan.results.flatMap((r) =>
      r.issues.filter((i) => i.level === level).map((i) => `  ${r.key} [${i.code}] ${i.message}`)
    );
  section('ERRORS (nothing is written until these are fixed)', issues('error'));
  section('WARNINGS', issues('warning'));
  section(
    'TRANSLATOR COMMENTS',
    plan.results.filter((r) => r.comment).map((r) => `  ${r.key}: ${r.comment}`)
  );
  section(
    'CRITICAL KEYS CHANGED (back-translate and compare with English before committing)',
    by('changed')
      .filter((r) => r.critical)
      .flatMap((r) => [`  ${r.key}`, `    en:  ${show(r.en)}`, `    new: ${show(r.text)}`])
  );
  if (verbose)
    section(
      'CHANGED',
      by('changed').map((r) => `  ${r.key}`)
    );
  return lines.join('\n');
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const unknown = args.filter((a) => a.startsWith('--') && !['--write', '--verbose'].includes(a));
  if (!file || unknown.length) {
    console.error('usage: node scripts/i18n-import.mjs <file> [--write] [--verbose]');
    process.exit(2);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(
      `i18n-import: cannot read ${file}: ${error instanceof Error ? error.message : error}`
    );
    process.exit(2);
  }
  const plan = planImport(doc);
  console.log(formatReport(plan, { verbose: args.includes('--verbose') }));
  if (plan.fatal.length) process.exit(2);
  if (plan.errors > 0) process.exit(1);
  if (args.includes('--write')) {
    applyImport(plan);
    console.log(
      `\nWritten: ${[...plan.updates.keys()].join(', ') || 'nothing to change'}. Run node scripts/check-i18n-parity.mjs next.`
    );
    if (plan.reviewed.length)
      console.log(
        `Recorded ${plan.reviewed.length} string(s) as reviewed in ${relative(REPO_PATHS.REPO_ROOT, reviewPath(plan.locale))}.`
      );
  } else {
    console.log('\nDry run. Add --write to apply.');
  }
}
