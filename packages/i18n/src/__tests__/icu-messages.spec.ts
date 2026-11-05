import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../config';
import {
  formatProblems,
  listCatalogs,
  pluralCategories,
  validateCatalogs,
  validateMessage,
  validateSource,
  type Message
} from '../../../../scripts/i18n-messages.mjs';

/**
 * Every shipped message is checked with the ICU parser svelte-i18n uses at
 * runtime. check-i18n-parity only compares keys, so before this a message that
 * lost a placeholder or broke ICU syntax went unnoticed until a user saw it:
 * `'{name}'` (apostrophes around a placeholder) rendered the text "{name}" in
 * the English and Spanish re/task "Delete list" dialog. Validation rules live
 * in scripts/i18n-messages.mjs, shared with check-i18n-parity and
 * i18n-import.
 */
const codes = (input: {
  en: Message;
  text: unknown;
  locale: string;
  mode?: 'catalog' | 'import';
  syntax?: 'icu' | 'plain';
}) => validateMessage(input).map((i) => i.code);
const char = (codePoint: number) => String.fromCodePoint(codePoint);

describe('shipped translations', () => {
  it('cover notes, common, every task file and the release notes', () => {
    const ids = listCatalogs().map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['notes', 'common', 'tasks/settings', 'release-notes'])
    );
  });

  it('are valid ICU and match English placeholders, options and plural rules in every locale', () => {
    const errors = validateCatalogs({ locales: SUPPORTED_LOCALES }).filter(
      (p) => p.level === 'error'
    );
    expect(formatProblems(errors)).toBe('');
  });
});

describe('validateSource (English)', () => {
  it('accepts plain text, placeholders and plurals', () => {
    expect(validateSource('Hello {name}')).toEqual([]);
    expect(validateSource('{count, plural, one {# note} other {# notes}}')).toEqual([]);
  });

  it('flags a placeholder quoted into text by apostrophes', () => {
    expect(validateSource("Are you sure you want to delete '{name}'?").map((i) => i.code)).toEqual([
      'quoted-placeholder'
    ]);
  });

  it('flags broken ICU syntax', () => {
    expect(validateSource('{count, plural, one {# note}').map((i) => i.code)).toEqual([
      'icu-syntax'
    ]);
  });

  it('treats release notes as plain text', () => {
    expect(validateSource("Fixed '{name}' in the editor", 'plain')).toEqual([]);
  });
});

describe('validateMessage - catalog level (CI)', () => {
  it('accepts a correct translation', () => {
    expect(codes({ en: 'Delete "{name}"?', text: 'Usunąć „{name}"?', locale: 'pl' })).toEqual([]);
  });

  it('flags a missing or renamed placeholder', () => {
    expect(codes({ en: 'Hello {name}', text: 'Cześć', locale: 'pl' })).toEqual(['missing-arg']);
    expect(codes({ en: 'Hello {name}', text: 'Cześć {imie}', locale: 'pl' })).toEqual([
      'missing-arg',
      'extra-arg'
    ]);
  });

  it('flags the French elision trap: an apostrophe before a brace swallows the placeholder', () => {
    expect(codes({ en: 'Open {name}', text: "Ouvrir l'{name}", locale: 'fr' })).toEqual([
      'quoted-placeholder',
      'missing-arg'
    ]);
  });

  it('flags a plural turned into a plain value', () => {
    expect(
      codes({ en: '{n, plural, one {# day} other {# days}}', text: '{n} dni', locale: 'pl' })
    ).toEqual(['arg-kind']);
  });

  it('flags plural categories the locale does not have', () => {
    const en = '{n, plural, one {# day} other {# days}}';
    expect(
      codes({ en, text: '{n, plural, one {# Tag} few {# Tage} other {# Tage}}', locale: 'de' })
    ).toEqual(['plural-category']);
    expect(
      codes({ en, text: '{n, plural, =0 {keine} one {# Tag} other {# Tage}}', locale: 'de' })
    ).toEqual([]);
  });

  it('flags select options that differ from English', () => {
    const en = '{period, select, daily {day} weekly {week} other {period}}';
    expect(
      codes({ en, text: '{period, select, daily {dzień} other {okres}}', locale: 'pl' })
    ).toEqual(['select-options']);
    expect(
      codes({
        en,
        text: '{period, select, daily {dzień} weekly {tydzień} yearly {rok} other {okres}}',
        locale: 'pl'
      })
    ).toEqual(['select-options']);
  });

  it('flags bidi overrides, isolates and invisible characters, but allows LRM, RLM and ALM', () => {
    for (const cp of [0x202e, 0x202a, 0x2066, 0x2069, 0x200b, 0x200d, 0xfeff]) {
      expect(codes({ en: 'Unlock', text: `فتح${char(cp)} القفل`, locale: 'ar' })).toEqual([
        'forbidden-char'
      ]);
    }
    for (const cp of [0x200e, 0x200f, 0x061c]) {
      expect(
        codes({ en: 'Open re/notes', text: `افتح ${char(cp)}re/notes`, locale: 'ar' })
      ).toEqual([]);
    }
  });

  it('checks list messages item by item', () => {
    expect(codes({ en: ['One', 'Two'], text: ['Jeden'], locale: 'pl' })).toEqual(['array-length']);
    expect(
      codes({ en: ['One', 'Two'], text: ['Jeden', `Dwa${char(0x202e)}`], locale: 'pl' })
    ).toEqual(['forbidden-char']);
    expect(codes({ en: ['One'], text: 'Jeden', locale: 'pl' })).toEqual(['not-array']);
  });
});

describe('validateMessage - import level (translator files)', () => {
  const arPlural =
    '{count, plural, zero {لا ملاحظات} one {ملاحظة واحدة} two {ملاحظتان} few {# ملاحظات} many {# ملاحظة} other {# ملاحظة}}';
  const en = '{count, plural, one {# note} other {# notes}}';

  it('knows the six Arabic plural categories', () => {
    expect([...pluralCategories('ar')].sort()).toEqual([
      'few',
      'many',
      'one',
      'other',
      'two',
      'zero'
    ]);
  });

  it('requires every plural form of the locale', () => {
    const partial = '{count, plural, one {ملاحظة واحدة} other {# ملاحظة}}';
    expect(codes({ en, text: partial, locale: 'ar' })).toEqual([]);
    expect(codes({ en, text: partial, locale: 'ar', mode: 'import' })).toEqual([
      'plural-incomplete'
    ]);
    expect(codes({ en, text: arPlural, locale: 'ar', mode: 'import' })).toEqual([]);
  });

  it('rejects links, e-mails, domains and markup English does not have', () => {
    const mode = 'import';
    expect(codes({ en: 'Unlock', text: 'افتح https://example.com', locale: 'ar', mode })).toEqual([
      'new-url'
    ]);
    expect(codes({ en: 'Unlock', text: 'راسل help@example.org', locale: 'ar', mode })).toEqual([
      'new-url'
    ]);
    expect(codes({ en: 'Unlock', text: 'زر reapps-help.com', locale: 'ar', mode })).toEqual([
      'new-url'
    ]);
    expect(codes({ en: 'Unlock', text: 'فتح <b>القفل</b>', locale: 'ar', mode })).toEqual([
      'new-tag'
    ]);
    expect(codes({ en: 'Visit reapps.eu', text: 'زر reapps.eu', locale: 'ar', mode })).toEqual([]);
  });

  it('rejects Eastern Arabic digits and warns about numbers English does not have', () => {
    const mode = 'import';
    expect(
      codes({
        en: 'Enter the 6-digit code',
        text: 'أدخل الرمز المكون من ٦ أرقام',
        locale: 'ar',
        mode
      })
    ).toEqual(['digits']);
    expect(
      codes({
        en: 'Enter the 6-digit code',
        text: 'أدخل الرمز المكون من 6 أرقام',
        locale: 'ar',
        mode
      })
    ).toEqual([]);
    const changed = validateMessage({
      en: 'Enter the 6-digit code',
      text: 'أدخل الرمز المكون من 8 أرقام',
      locale: 'ar',
      mode
    });
    expect(changed.map((i) => [i.level, i.code])).toEqual([['warning', 'new-number']]);
  });

  it('rejects an em-dash and an empty translation', () => {
    expect(
      codes({
        en: 'Saved - done',
        text: `تم الحفظ ${char(0x2014)} انتهى`,
        locale: 'ar',
        mode: 'import'
      })
    ).toEqual(['em-dash']);
    expect(codes({ en: 'Saved', text: '  ', locale: 'ar', mode: 'import' })).toEqual(['empty']);
  });

  it('warns about text identical to English', () => {
    expect(codes({ en: 'Markdown', text: 'Markdown', locale: 'ar', mode: 'import' })).toEqual([
      'untranslated'
    ]);
  });
});
