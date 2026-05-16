#!/usr/bin/env node
// Verify i18n locale parity across all 5 supported locales (en/pl/de/fr/es).
//
// `en` is the source of truth. For each non-EN locale the script reports:
//   - missing keys (present in EN, absent in the locale)
//   - extra keys   (present in the locale, absent in EN)
//
// Namespaces:
//   - notes  : flat per-locale file  (notes/<locale>.json)
//   - common : flat per-locale file  (common/<locale>.json)
//   - tasks  : per-locale folder, compared file-by-file (tasks/<locale>/*.json)
//
// Usage (from repo root):
//   node scripts/check-i18n-parity.mjs
//   node scripts/check-i18n-parity.mjs --namespace=notes
//   node scripts/check-i18n-parity.mjs --namespace=tasks
//   node scripts/check-i18n-parity.mjs --verbose      # dump every drifted key
//
// Exit code: 0 when all locales match EN, 1 when any drift is found.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS_DIR = resolve(__dirname, '..', 'packages', 'i18n', 'src', 'translations');
const LOCALES = ['en', 'pl', 'de', 'fr', 'es'];
const NON_EN = LOCALES.filter((l) => l !== 'en');
const PREVIEW_LIMIT = 10;

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
let onlyNamespace = null;
for (const a of argv) {
  const m = /^--namespace=(.+)$/.exec(a);
  if (m) onlyNamespace = m[1];
}

function flatten(obj, prefix = '') {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function diff(enKeys, otherKeys) {
  const enSet = new Set(enKeys);
  const otherSet = new Set(otherKeys);
  return {
    missing: enKeys.filter((k) => !otherSet.has(k)),
    extra: otherKeys.filter((k) => !enSet.has(k)),
  };
}

function fmtKeys(keys) {
  if (verbose || keys.length <= PREVIEW_LIMIT) return keys.join(', ');
  return `${keys.slice(0, PREVIEW_LIMIT).join(', ')}, ...(+${keys.length - PREVIEW_LIMIT} more)`;
}

let hasDrift = false;

function checkFlat(namespace) {
  console.log(`\n[${namespace}]`);
  const enKeys = flatten(readJson(join(TRANSLATIONS_DIR, namespace, 'en.json')));
  console.log(`  en  TOTAL ${enKeys.length} keys`);
  for (const locale of NON_EN) {
    const path = join(TRANSLATIONS_DIR, namespace, `${locale}.json`);
    const keys = flatten(readJson(path));
    const { missing, extra } = diff(enKeys, keys);
    const status = missing.length === 0 && extra.length === 0 ? 'OK' : 'DRIFT';
    console.log(`  ${locale.padEnd(3)} ${status.padEnd(6)} missing=${missing.length} extra=${extra.length}`);
    if (missing.length) console.log(`    missing: ${fmtKeys(missing)}`);
    if (extra.length) console.log(`    extra:   ${fmtKeys(extra)}`);
    if (missing.length || extra.length) hasDrift = true;
  }
}

function checkTasks() {
  console.log(`\n[tasks] (per-file)`);
  const enDir = join(TRANSLATIONS_DIR, 'tasks', 'en');
  const files = readdirSync(enDir).filter((f) => f.endsWith('.json')).sort();

  const totals = Object.fromEntries(NON_EN.map((l) => [l, { missing: 0, extra: 0, missingFiles: 0 }]));
  const perLocale = Object.fromEntries(NON_EN.map((l) => [l, []]));

  let enTotal = 0;
  for (const file of files) {
    const enKeys = flatten(readJson(join(enDir, file)));
    enTotal += enKeys.length;
    for (const locale of NON_EN) {
      const path = join(TRANSLATIONS_DIR, 'tasks', locale, file);
      let keys;
      try {
        keys = flatten(readJson(path));
      } catch {
        totals[locale].missingFiles += 1;
        perLocale[locale].push({ file, missingFile: true });
        continue;
      }
      const d = diff(enKeys, keys);
      totals[locale].missing += d.missing.length;
      totals[locale].extra += d.extra.length;
      if (d.missing.length || d.extra.length) {
        perLocale[locale].push({ file, missing: d.missing, extra: d.extra });
      }
    }
  }

  console.log(`  en  TOTAL ${enTotal} keys across ${files.length} files`);
  for (const locale of NON_EN) {
    const { missing, extra, missingFiles } = totals[locale];
    const drift = missing > 0 || extra > 0 || missingFiles > 0;
    const status = drift ? 'DRIFT' : 'OK';
    console.log(
      `  ${locale.padEnd(3)} ${status.padEnd(6)} missing=${missing} extra=${extra}` +
        (missingFiles ? ` missingFiles=${missingFiles}` : ''),
    );
    for (const entry of perLocale[locale]) {
      if (entry.missingFile) {
        console.log(`    ${entry.file}: MISSING FILE`);
        continue;
      }
      console.log(`    ${entry.file}:`);
      if (entry.missing.length) console.log(`      missing: ${fmtKeys(entry.missing)}`);
      if (entry.extra.length) console.log(`      extra:   ${fmtKeys(entry.extra)}`);
    }
    if (drift) hasDrift = true;
  }
}

const namespaces = onlyNamespace ? [onlyNamespace] : ['notes', 'common', 'tasks'];
for (const ns of namespaces) {
  if (ns === 'tasks') checkTasks();
  else if (ns === 'notes' || ns === 'common') checkFlat(ns);
  else {
    console.error(`Unknown namespace: ${ns} (expected notes | common | tasks)`);
    process.exit(2);
  }
}

console.log();
console.log(hasDrift ? 'Locale parity check FAILED.' : 'Locale parity check PASSED.');
process.exit(hasDrift ? 1 : 0);
