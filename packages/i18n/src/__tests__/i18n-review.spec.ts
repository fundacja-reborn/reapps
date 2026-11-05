import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport, type CatalogReader } from '../../../../scripts/i18n-export.mjs';
import { listCatalogs, type Message, type Messages } from '../../../../scripts/i18n-messages.mjs';
import {
  REVIEW_DIR,
  hashMessage,
  parseReview,
  readReview,
  recordReviewed,
  reviewStatus,
  serializeReview,
  sourceKeys,
  stringStatus,
  trackedLocales,
  writeReview,
  type ReviewRecord
} from '../../../../scripts/i18n-review.mjs';
import { readSupportedLocales } from '../../../../scripts/supported-locales.mjs';

/**
 * Review queue (Arabic plan, Phase 4): packages/i18n/review/<locale>.json holds
 * hashes of the English and the translation a translator reviewed; everything
 * else is a draft. Catalogs are read through an in-memory reader, so nothing
 * here touches the real translation or review files (except the last block,
 * which only reads them).
 */
const EN: [string, Message][] = [
  ['nav.all_notes', 'All notes'],
  ['nav.starred', 'Starred'],
  ['nav.trash', 'Trash'],
  ['nav.tags', 'Tags'],
  ['pages.list', ['One', 'Two']]
];
const AR: [string, Message][] = [
  ['nav.all_notes', 'كل الملاحظات'],
  ['nav.starred', 'المميّزة بنجمة'],
  ['nav.trash', 'سلة المهملات'],
  ['nav.tags', 'الوسوم'],
  ['pages.list', ['واحد', 'اثنان']]
];

function reader(files: Record<string, [string, Message][]>): CatalogReader {
  return (catalog, locale) => {
    const entries = files[`${catalog.id}@${locale}`];
    return entries ? (new Map(entries) as Messages) : null;
  };
}
const notes = listCatalogs().filter((c) => c.id === 'notes');
const read = reader({ 'notes@en': EN, 'notes@ar': AR });
const at = (list: [string, Message][], key: string) => {
  const found = list.find(([k]) => k === key);
  if (!found) throw new Error(`no ${key}`);
  return found[1];
};
const record = (key: string, en = at(EN, key), text = at(AR, key)): [string, ReviewRecord] => [
  `notes:${key}`,
  { en: hashMessage(en), text: hashMessage(text) }
];

describe('i18n-review: status', () => {
  it('hashes messages into short, stable fingerprints', () => {
    expect(hashMessage('Starred')).toMatch(/^[0-9a-f]{12}$/);
    expect(hashMessage('Starred')).toBe(hashMessage('Starred'));
    expect(hashMessage(['a', 'b'])).not.toBe(hashMessage('a,b'));
  });

  it('tells reviewed, stale (English changed), edited (translation changed) and draft apart', () => {
    const reviewed = new Map<string, ReviewRecord>([
      record('nav.all_notes'),
      record('nav.starred', 'Starred items'), // English was different at review time
      record('nav.trash', 'Trash', 'المهملات'), // we changed the translation since
      record('pages.list')
    ]);
    const report = reviewStatus({ locale: 'ar', review: { reviewed }, read, catalogs: notes });
    expect(report.strings).toEqual([
      { key: 'notes:nav.all_notes', status: 'reviewed' },
      { key: 'notes:nav.starred', status: 'stale' },
      { key: 'notes:nav.trash', status: 'edited' },
      { key: 'notes:nav.tags', status: 'draft' },
      { key: 'notes:pages.list', status: 'reviewed' }
    ]);
    expect(report.counts).toEqual({ reviewed: 2, stale: 1, edited: 1, draft: 1 });
    expect(report.byCatalog.get('notes')).toEqual(report.counts);
    expect(report.total).toBe(5);
    expect(stringStatus(record('nav.tags')[1], 'Tags', undefined)).toBe('draft');
  });

  it('reports records of removed keys only for the catalogs it looked at', () => {
    const reviewed = new Map<string, ReviewRecord>([
      record('nav.all_notes'),
      ['notes:nav.removed', { en: hashMessage('x'), text: hashMessage('y') }],
      ['common:actions.save', { en: hashMessage('Save'), text: hashMessage('حفظ') }],
      ['gone-catalog:a.b', { en: hashMessage('a'), text: hashMessage('b') }]
    ]);
    const report = reviewStatus({ locale: 'ar', review: { reviewed }, read, catalogs: notes });
    expect(report.orphans).toEqual(['notes:nav.removed', 'gone-catalog:a.b']);
  });
});

describe('i18n-review: file', () => {
  const order = sourceKeys({ read, catalogs: notes });

  it('writes one line per record in source order and reads it back', () => {
    const reviewed = new Map<string, ReviewRecord>([record('pages.list'), record('nav.all_notes')]);
    const text = serializeReview('ar', reviewed, order);
    const lines = text.split('\n').filter((l) => l.includes('"notes:'));
    expect(lines).toEqual([
      `    "notes:nav.all_notes": { "en": "${hashMessage('All notes')}", "ar": "${hashMessage('كل الملاحظات')}" },`,
      `    "notes:pages.list": { "en": "${hashMessage(['One', 'Two'])}", "ar": "${hashMessage(['واحد', 'اثنان'])}" }`
    ]);
    expect(parseReview(text, 'ar').reviewed).toEqual(
      new Map([record('nav.all_notes'), record('pages.list')])
    );
    expect(parseReview(serializeReview('ar', new Map(), order), 'ar').reviewed.size).toBe(0);
  });

  it('rejects a malformed file instead of treating everything as a draft', () => {
    const good = JSON.parse(serializeReview('ar', new Map([record('nav.tags')]), order));
    const bad = (patch: object) => JSON.stringify({ ...good, ...patch });
    expect(() => parseReview('{', 'ar')).toThrow(/invalid JSON/);
    expect(() => parseReview(bad({ format: 'other' }), 'ar')).toThrow(/format/);
    expect(() => parseReview(bad({ locale: 'de' }), 'ar')).toThrow(/locale/);
    expect(() =>
      parseReview(bad({ reviewed: { 'notes:nav.tags': { en: 'short', ar: 'x' } } }), 'ar')
    ).toThrow(/hashes/);
    expect(() =>
      parseReview(bad({ reviewed: { 'no-catalog': good.reviewed['notes:nav.tags'] } }), 'ar')
    ).toThrow(/catalog:key/);
  });

  it('records reviews and drops keys English no longer has when writing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-review-'));
    try {
      const current = new Map<string, ReviewRecord>([
        ['notes:nav.removed', { en: hashMessage('x'), text: hashMessage('y') }]
      ]);
      const next = recordReviewed(current, [
        { key: 'notes:nav.starred', en: 'Starred', text: 'المميّزة بنجمة' }
      ]);
      expect(current.size).toBe(1); // not mutated
      expect(writeReview('ar', next, { read, dir })).toEqual({ written: 1, dropped: 1 });
      expect(readReview('ar', dir)?.reviewed).toEqual(new Map([record('nav.starred')]));
      expect(readFileSync(join(dir, 'ar.json'), 'utf8')).not.toContain('nav.removed');
      expect(trackedLocales(dir)).toEqual(['ar']);
      expect(readReview('de', dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('i18n-export --only=unreviewed', () => {
  const usage = { exact: new Map(), dynamic: [] };
  const review = {
    locale: 'ar',
    reviewed: new Map<string, ReviewRecord>([
      record('nav.all_notes'),
      record('nav.starred', 'Starred items'),
      record('nav.trash', 'Trash', 'المهملات'),
      record('pages.list')
    ])
  };
  const exportAr = (only: 'all' | 'unreviewed') =>
    buildExport({
      locale: 'ar',
      catalogs: ['notes'],
      usage,
      read,
      review,
      only,
      date: '2026-11-05'
    });

  it('exports only strings needing review, saying why a reviewed one is back', () => {
    const doc = exportAr('unreviewed');
    expect(doc.strings.map((s) => [s.key, s.review])).toEqual([
      ['notes:nav.starred', 'The English changed after your last review.'],
      ['notes:nav.trash', 'We changed this translation after your last review.'],
      ['notes:nav.tags', undefined]
    ]);
    expect(doc.instructions.join('\n')).toContain('"review" says why');
  });

  it('notes the changed strings in a full export too, and needs a tracked locale for unreviewed', () => {
    expect(
      exportAr('all')
        .strings.filter((s) => s.review)
        .map((s) => s.key)
    ).toEqual(['notes:nav.starred', 'notes:nav.trash']);
    expect(() =>
      buildExport({
        locale: 'ar',
        catalogs: ['notes'],
        usage,
        read,
        review: null,
        only: 'unreviewed'
      })
    ).toThrow(/no review file/);
  });
});

describe('review files in the repo', () => {
  it('are well-formed and belong to supported, non-source locales', () => {
    const supported = readSupportedLocales().filter((l) => l !== 'en');
    for (const locale of trackedLocales()) {
      expect(supported).toContain(locale);
      expect(() => readReview(locale)).not.toThrow();
    }
    expect(REVIEW_DIR.replace(/\\/g, '/')).toMatch(/packages\/i18n\/review$/);
  });
});
