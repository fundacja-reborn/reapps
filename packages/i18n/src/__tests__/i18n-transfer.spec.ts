import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TRANSFER_FORMAT,
  buildExport,
  findUsage,
  scanKeyUsage,
  type CatalogReader,
  type KeyUsage
} from '../../../../scripts/i18n-export.mjs';
import { applyImport, formatReport, planImport } from '../../../../scripts/i18n-import.mjs';
import { hashMessage, type ReviewRecord } from '../../../../scripts/i18n-review.mjs';
import {
  locateLeaves,
  patchCatalogText,
  type Message,
  type Messages
} from '../../../../scripts/i18n-messages.mjs';

/**
 * Translator round trip (Arabic plan, Phase 3): i18n-export writes a JSON file
 * per batch, the translator edits the "ar" values, i18n-import validates it and
 * writes the locale files. Catalogs are read through an in-memory reader here,
 * so nothing touches the real translation files.
 */
const EN: [string, Message][] = [
  ['app_lock.unlock_cta', 'Unlock'],
  ['auth.unlock.title', 'Unlock your notes'],
  ['folders.count', '{count, plural, one {# folder} other {# folders}}'],
  ['folders.delete', 'Delete "{name}"?'],
  ['pages.list', ['One', 'Two']]
];
const AR: [string, Message][] = [
  ['app_lock.unlock_cta', 'فتح القفل'],
  ['auth.unlock.title', 'افتح ملاحظاتك'],
  [
    'folders.count',
    '{count, plural, zero {لا مجلدات} one {مجلد واحد} two {مجلدان} few {# مجلدات} many {# مجلدًا} other {# مجلد}}'
  ],
  ['folders.delete', 'حذف «{name}»؟'],
  ['pages.list', ['واحد', 'اثنان']]
];

function reader(files: Record<string, [string, Message][]>): CatalogReader {
  return (catalog, locale) => {
    const entries = files[`${catalog.id}@${locale}`];
    return entries ? (new Map(entries) as Messages) : null;
  };
}
const read = reader({ 'notes@en': EN, 'notes@ar': AR });
const usage: KeyUsage = {
  exact: new Map([
    ['app_lock.unlock_cta', new Set(['apps/reborn-notes/src/routes/unlock/+page.svelte'])]
  ]),
  dynamic: [
    { prefix: 'folders.', file: 'apps/reborn-notes/src/lib/components/folders/FolderTree.svelte' }
  ]
};
// `review: null`: never read the real packages/i18n/review/ar.json here.
const exportAr = (extra: Partial<Parameters<typeof buildExport>[0]> = {}) =>
  buildExport({
    locale: 'ar',
    catalogs: ['notes'],
    usage,
    read,
    date: '2026-11-04',
    review: null,
    ...extra
  });
function entry(doc: ReturnType<typeof exportAr>, key: string) {
  const found = doc.strings.find((s) => s.key === `notes:${key}`);
  if (!found) throw new Error(`no exported entry for ${key}`);
  return found;
}

describe('i18n-export', () => {
  it('writes key, English, current translation, where it appears and plural hints', () => {
    const doc = exportAr();
    expect(doc).toMatchObject({
      format: TRANSFER_FORMAT,
      version: 1,
      locale: 'ar',
      exported: '2026-11-04'
    });
    expect(entry(doc, 'app_lock.unlock_cta')).toEqual({
      key: 'notes:app_lock.unlock_cta',
      en: 'Unlock',
      ar: 'فتح القفل',
      where: ['apps/reborn-notes/src/routes/unlock/+page.svelte']
    });
    expect(entry(doc, 'folders.count')).toMatchObject({
      where: ['apps/reborn-notes/src/lib/components/folders/FolderTree.svelte (key built in code)'],
      placeholders: ['{count}'],
      plural: ['{count}: zero, one, two, few, many, other']
    });
    expect(entry(doc, 'auth.unlock.title').where).toEqual([]);
  });

  it('leaves the translation empty when the locale has none yet, and can skip unreferenced keys', () => {
    const doc = buildExport({
      locale: 'ar',
      catalogs: ['notes'],
      usage,
      read: reader({ 'notes@en': EN }),
      review: null
    });
    expect(entry(doc, 'app_lock.unlock_cta').ar).toBe('');
    expect(entry(doc, 'pages.list').ar).toEqual(['', '']);
    expect(exportAr({ referenced: true }).strings.map((s) => s.key)).not.toContain(
      'notes:auth.unlock.title'
    );
    expect(exportAr({ prefixes: ['folders.'] }).strings).toHaveLength(2);
  });

  it('finds keys written out in full and keys built in templates or by concatenation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-usage-'));
    try {
      const a = join(dir, 'A.svelte');
      const b = join(dir, 'b.ts');
      writeFileSync(a, "{$t('app_lock.unlock_cta')} {$t(`whats_new.category_${group.category}`)}");
      writeFileSync(b, "const label = t('settings.section.' + id);");
      const scanned = scanKeyUsage([a, b]);
      expect(findUsage('app_lock.unlock_cta', scanned)).toMatchObject({ dynamic: false });
      expect(findUsage('whats_new.category_new', scanned)).toMatchObject({ dynamic: true });
      expect(findUsage('settings.section.title', scanned)).toMatchObject({ dynamic: true });
      expect(findUsage('auth.unlock.title', scanned).files).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('i18n-import', () => {
  it('a file returned unchanged imports cleanly and changes nothing', () => {
    const plan = planImport(JSON.parse(JSON.stringify(exportAr())), { read });
    expect(plan.errors).toBe(0);
    expect(plan.updates.size).toBe(0);
    expect(plan.results.every((r) => r.status === 'unchanged')).toBe(true);
  });

  it('applies changes, flags security-critical ones for back-translation and keeps comments', () => {
    const doc = exportAr();
    entry(doc, 'auth.unlock.title').ar = 'افتح ملاحظاتك الآن';
    entry(doc, 'app_lock.unlock_cta').comment = 'Is this the usual Android wording?';
    const plan = planImport(doc, { read });
    expect(plan.errors).toBe(0);
    expect(plan.updates.get('notes')).toEqual(
      new Map([['auth.unlock.title', 'افتح ملاحظاتك الآن']])
    );
    const report = formatReport(plan);
    expect(report).toContain('CRITICAL KEYS CHANGED');
    expect(report).toContain('notes:auth.unlock.title');
    expect(report).toContain('Is this the usual Android wording?');

    const written: [string, Map<string, Message>][] = [];
    const recorded: Map<string, ReviewRecord>[] = [];
    applyImport(plan, {
      read,
      write: (catalog, _locale, changes) => written.push([catalog.id, changes]),
      readReviewFile: () => null,
      writeReviewFile: (_locale, reviewed) => recorded.push(reviewed)
    });
    expect(written).toEqual([['notes', new Map([['auth.unlock.title', 'افتح ملاحظاتك الآن']])]]);
    // Every imported entry counts as reviewed, the unchanged ones too, with
    // hashes of what the translator saw and returned.
    expect(recorded).toHaveLength(1);
    expect([...recorded[0].keys()]).toEqual(EN.map(([key]) => `notes:${key}`));
    expect(recorded[0].get('notes:auth.unlock.title')).toEqual({
      en: hashMessage('Unlock your notes'),
      text: hashMessage('افتح ملاحظاتك الآن')
    });
  });

  it('skips entries whose English changed since the export', () => {
    const doc = exportAr();
    entry(doc, 'app_lock.unlock_cta').en = 'Unlock now';
    entry(doc, 'app_lock.unlock_cta').ar = 'افتح الآن';
    const plan = planImport(doc, { read });
    expect(plan.errors).toBe(0);
    expect(plan.results.find((r) => r.key === 'notes:app_lock.unlock_cta')?.status).toBe('stale');
    expect(plan.updates.size).toBe(0);
    expect(plan.reviewed.map((r) => r.key)).not.toContain('notes:app_lock.unlock_cta');
  });

  it('is all or nothing: one invalid entry blocks the whole file', () => {
    const doc = exportAr();
    entry(doc, 'auth.unlock.title').ar = 'افتح ملاحظاتك';
    entry(doc, 'folders.count').ar = '{count, plural, one {مجلد واحد} other {# مجلد}}';
    entry(doc, 'folders.delete').ar = 'حذف؟';
    const plan = planImport(doc, { read });
    expect(plan.results.flatMap((r) => r.issues.map((i) => i.code))).toEqual([
      'plural-incomplete',
      'missing-arg'
    ]);
    expect(() => applyImport(plan, { read, write: () => undefined })).toThrow(/validation errors/);
  });

  it('rejects duplicates, unknown keys, missing locale files and foreign files', () => {
    const doc = exportAr();
    doc.strings.push({ ...doc.strings[0] }, { key: 'notes:nope.key', en: 'x', ar: 'y', where: [] });
    const plan = planImport(doc, { read });
    expect(plan.results.flatMap((r) => r.issues.map((i) => i.code))).toEqual([
      'duplicate',
      'unknown-key'
    ]);

    const noFile = planImport(exportAr(), { read: reader({ 'notes@en': EN }) });
    expect(noFile.results.flatMap((r) => r.issues.map((i) => i.code))).toEqual(['missing-file']);

    expect(planImport({ strings: [] }, { read }).fatal.length).toBeGreaterThan(0);
    expect(planImport({ ...exportAr(), locale: 'en' }, { read }).fatal).toContain(
      'cannot import into the source locale (en)'
    );
  });
});

describe('locale file patching', () => {
  const text = `{
  "a": { "b": "x", "c": "q\\"uote" },
  "d": ["p", "q"],
  "e": {
    "f": "keep"
  }
}
`;

  it('locates every leaf value, lists included', () => {
    const spans = locateLeaves(text);
    expect([...spans.keys()]).toEqual(['a.b', 'a.c', 'd', 'e.f']);
    const at = (key: string) => {
      const span = spans.get(key);
      if (!span) throw new Error(`no span for ${key}`);
      return text.slice(span.start, span.end);
    };
    expect(at('a.c')).toBe('"q\\"uote"');
    expect(at('d')).toBe('["p", "q"]');
  });

  it('replaces only the changed values and keeps the formatting', () => {
    const patched = patchCatalogText(
      text,
      new Map<string, Message>([
        ['a.c', 'نعم'],
        ['d', ['ص', 'ق']]
      ])
    );
    expect(patched).toBe(text.replace('"q\\"uote"', '"نعم"').replace('["p", "q"]', '["ص","ق"]'));
    expect(patchCatalogText(text, new Map([['a.z', 'new']]))).toBeNull();
  });
});
