#!/usr/bin/env node
// Export the curated release-notes dataset to a single portable JSON that the
// public website (reapps-www, a separate repo) renders on its /changelog page.
//
// The in-app "What's new" dialog reads the dataset directly from @reborn/i18n;
// the website cannot import that package (standalone Astro repo), so this script
// flattens manifest + upcoming + per-locale text into one self-contained file that gets
// committed into reapps-www. One source of truth, two surfaces.
//
// Run at release time (after `pnpm release`), then commit the result in
// reapps-www and deploy:
//   node scripts/export-release-notes.mjs                 # writes the default path
//   node scripts/export-release-notes.mjs --out <path>    # custom destination
//   node scripts/export-release-notes.mjs --stdout        # print, don't write
//
// The website only renders en + pl today, but all 5 locales are exported so the
// data is ready if the site grows - and so this stays a faithful mirror.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RN_DIR = resolve(__dirname, '..', 'packages', 'i18n', 'src', 'release-notes');
const TEXT_DIR = join(RN_DIR, 'text');
const LOCALES = ['en', 'pl', 'de', 'fr', 'es'];
const DEFAULT_OUT = resolve(__dirname, '..', '..', 'reapps-www', 'src', 'data', 'release-notes.json');

const argv = process.argv.slice(2);
const toStdout = argv.includes('--stdout');
let outPath = DEFAULT_OUT;
for (const a of argv) {
  const m = /^--out=(.+)$/.exec(a);
  if (m) outPath = resolve(m[1]);
  if (a === '--out') {
    const idx = argv.indexOf(a);
    if (argv[idx + 1]) outPath = resolve(argv[idx + 1]);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const manifest = readJson(join(RN_DIR, 'manifest.json'));
const upcoming = readJson(join(RN_DIR, 'upcoming.json'));
const text = Object.fromEntries(LOCALES.map((l) => [l, readJson(join(TEXT_DIR, `${l}.json`))]));

// Fail loudly on any missing translation so a release never ships a half-empty
// changelog to the website. (The @reborn/i18n Vitest test enforces the same
// invariant in CI; this is the export-time guard.)
const missing = [];
for (const release of manifest) {
  for (const item of release.items) {
    for (const locale of LOCALES) {
      const entry = text[locale][item.id];
      if (typeof entry !== 'string' || entry.length === 0) missing.push(`${locale}:${item.id}`);
    }
  }
}
for (const item of upcoming) {
  for (const locale of LOCALES) {
    const entry = text[locale][item.id];
    if (typeof entry !== 'string' || entry.length === 0) missing.push(`${locale}:${item.id}`);
  }
}
if (missing.length) {
  console.error(`[export-release-notes] Missing translations:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

const releases = manifest.map((release) => ({
  version: release.version,
  date: release.date,
  items: release.items.map((item) => ({
    id: item.id,
    category: item.category,
    apps: item.apps,
    platforms: item.platforms,
    text: Object.fromEntries(LOCALES.map((l) => [l, text[l][item.id]]))
  }))
}));

// Coming-soon entries live off the version axis (no version/date/category):
// rendered as a section atop the public changelog, mirroring what the in-app
// dialog shows on web.
const upcomingItems = upcoming.map((item) => ({
  id: item.id,
  apps: item.apps,
  platforms: item.platforms,
  text: Object.fromEntries(LOCALES.map((l) => [l, text[l][item.id]]))
}));

const output = {
  schema: 1,
  locales: LOCALES,
  releases,
  upcoming: upcomingItems
};

const json = JSON.stringify(output, null, 2) + '\n';

if (toStdout) {
  process.stdout.write(json);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json, 'utf8');
  const itemCount = releases.reduce((n, r) => n + r.items.length, 0);
  console.log(
    `[export-release-notes] Wrote ${releases.length} releases / ${itemCount} items + ${upcomingItems.length} upcoming (${LOCALES.length} locales) to ${outPath}`
  );
}
