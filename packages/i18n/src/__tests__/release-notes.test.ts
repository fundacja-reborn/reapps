import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { RELEASE_NOTES, compareVersions, selectReleases } from '../release-notes';
import type { ReleaseNotesText } from '../release-notes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEXT_DIR = join(__dirname, '..', 'release-notes', 'text');
const LOCALES = ['en', 'pl', 'de', 'fr', 'es'] as const;

const VALID_CATEGORIES = new Set(['new', 'improved', 'fixed']);
const VALID_APPS = new Set(['notes', 'task']);
const VALID_PLATFORMS = new Set(['web', 'android', 'ios', 'macos', 'windows', 'linux']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readText(locale: string): ReleaseNotesText {
  return JSON.parse(readFileSync(join(TEXT_DIR, `${locale}.json`), 'utf8'));
}

const allIds = RELEASE_NOTES.flatMap((r) => r.items.map((i) => i.id));

describe('release-notes manifest', () => {
  it('has unique item ids', () => {
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('uses valid enum values and ISO dates', () => {
    for (const release of RELEASE_NOTES) {
      expect(release.version, `version ${release.version}`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(release.date, `date for ${release.version}`).toMatch(ISO_DATE);
      expect(release.items.length, `items for ${release.version}`).toBeGreaterThan(0);
      for (const item of release.items) {
        expect(VALID_CATEGORIES.has(item.category), `category ${item.id}`).toBe(true);
        expect(item.apps.length, `apps ${item.id}`).toBeGreaterThan(0);
        for (const app of item.apps) expect(VALID_APPS.has(app), `app ${app} (${item.id})`).toBe(true);
        if (item.platforms !== 'all') {
          expect(item.platforms.length, `platforms ${item.id}`).toBeGreaterThan(0);
          for (const p of item.platforms) {
            expect(VALID_PLATFORMS.has(p), `platform ${p} (${item.id})`).toBe(true);
          }
        }
      }
    }
  });

  it('is ordered newest first', () => {
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      expect(
        compareVersions(RELEASE_NOTES[i - 1].version, RELEASE_NOTES[i].version),
        `${RELEASE_NOTES[i - 1].version} should be newer than ${RELEASE_NOTES[i].version}`
      ).toBeGreaterThan(0);
    }
  });
});

describe('release-notes translations', () => {
  for (const locale of LOCALES) {
    it(`${locale}: every manifest id has title (+ no orphan keys)`, () => {
      const text = readText(locale);
      for (const id of allIds) {
        expect(text[id], `${locale} missing "${id}"`).toBeTruthy();
        expect(typeof text[id].title, `${locale} "${id}" title`).toBe('string');
        expect(text[id].title.length, `${locale} "${id}" title empty`).toBeGreaterThan(0);
      }
      for (const key of Object.keys(text)) {
        expect(allIds.includes(key), `${locale} orphan key "${key}"`).toBe(true);
      }
    });

    it(`${locale}: description presence matches en`, () => {
      const en = readText('en');
      const text = readText(locale);
      for (const id of allIds) {
        expect(
          Boolean(text[id]?.description),
          `${locale} "${id}" description presence should match en`
        ).toBe(Boolean(en[id]?.description));
      }
    });
  }
});

describe('selectReleases', () => {
  const enText = readText('en');

  it('filters by app', () => {
    const taskOnly = selectReleases(enText, { app: 'task', platform: 'web' });
    const flat = taskOnly.flatMap((r) => r.items);
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.every((i) => i.apps.includes('task'))).toBe(true);
  });

  it('hides native-only items from web and vice versa', () => {
    const web = selectReleases(enText, { app: 'notes', platform: 'web' }).flatMap((r) => r.items);
    const ios = selectReleases(enText, { app: 'notes', platform: 'ios' }).flatMap((r) => r.items);
    expect(web.some((i) => i.id === '0.33.0-native-folder-sync')).toBe(false);
    expect(ios.some((i) => i.id === '0.33.0-native-folder-sync')).toBe(true);
    expect(ios.some((i) => i.id === '0.30.0-folder-sync-desktop')).toBe(false);
  });

  it('caps at untilVersion (frozen native bundle never shows newer notes)', () => {
    const capped = selectReleases(enText, { app: 'notes', platform: 'web', untilVersion: '0.20.0' });
    expect(capped.every((r) => compareVersions(r.version, '0.20.0') <= 0)).toBe(true);
  });
});
