/**
 * The supported UI locales, read from their single source:
 * `SUPPORTED_LOCALES` in packages/i18n/src/config.ts.
 *
 * Node scripts (check-i18n-parity, export-release-notes) cannot import that
 * TypeScript module on every Node version the repo is run with (type
 * stripping needs Node 22.18+ / 23.6+), so the array literal is parsed.
 * packages/i18n/src/__tests__/supported-locales.spec.ts checks the parsed list
 * against the real export, so a reformatted declaration fails CI instead of
 * silently returning a stale list.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/i18n/src/config.ts');

/** @returns {string[]} locale codes in declaration order (source locale `en` first). */
export function readSupportedLocales() {
  const source = readFileSync(CONFIG, 'utf-8');
  const declaration = source.match(/export const SUPPORTED_LOCALES = \[([^\]]*)\] as const;/);
  if (!declaration) {
    throw new Error(`supported-locales: SUPPORTED_LOCALES declaration not found in ${CONFIG}`);
  }
  const locales = [...declaration[1].matchAll(/'([a-z]{2,3}(?:-[A-Za-z0-9]+)*)'/g)].map((m) => m[1]);
  if (locales.length === 0) {
    throw new Error('supported-locales: SUPPORTED_LOCALES is empty or unparsable');
  }
  return locales;
}
