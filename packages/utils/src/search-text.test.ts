import { describe, expect, it } from 'vitest';
import { foldSearchText, searchPattern } from './search-text';

describe('foldSearchText', () => {
  it('removes tashkeel, so vocalized and plain Arabic compare equal', () => {
    expect(foldSearchText('كَتَبَ')).toBe('كتب');
    expect(foldSearchText('مُحَمَّدٌ')).toBe('محمد');
    expect(foldSearchText('الرَّحْمَٰنِ')).toBe('الرحمن');
  });

  it('removes the tatweel', () => {
    expect(foldSearchText('كـــتـــاب')).toBe('كتاب');
  });

  it('removes Quranic annotation signs', () => {
    expect(foldSearchText(`كتاب${String.fromCodePoint(0x06d6)}`)).toBe('كتاب');
  });

  it('keeps the base letters, including hamza forms', () => {
    expect(foldSearchText('أحمد')).toBe('أحمد');
    expect(foldSearchText('ة ى')).toBe('ة ى');
  });

  it('keeps Arabic digits and punctuation', () => {
    expect(foldSearchText('٣٤، ؟')).toBe('٣٤، ؟');
  });

  it('lower-cases other scripts and keeps their diacritics', () => {
    expect(foldSearchText('Żółć')).toBe('żółć');
    expect(foldSearchText('Mañana')).toBe('mañana');
  });
});

describe('searchPattern', () => {
  it('is a plain escaped literal for a query without Arabic letters', () => {
    expect(searchPattern('hello')).toBe('hello');
    expect(searchPattern('a.b*c')).toBe('a\\.b\\*c');
    expect(searchPattern('żółć')).toBe('żółć');
  });

  it('finds plain query in vocalized text', () => {
    expect(new RegExp(searchPattern('كتب')).test('قد كَتَبَ الدرس')).toBe(true);
  });

  it('finds vocalized query in plain text', () => {
    expect(new RegExp(searchPattern('كَتَبَ')).test('قد كتب الدرس')).toBe(true);
  });

  it('does not match different base letters', () => {
    expect(new RegExp(searchPattern('كتب')).test('كتف')).toBe(false);
  });

  it('keeps literal characters between Arabic words', () => {
    expect(new RegExp(searchPattern('كتاب (جديد)')).test('كِتَاب (جَدِيد)')).toBe(true);
  });

  it('is empty for a query of marks alone', () => {
    expect(searchPattern('َُِ')).toBe('');
    expect(searchPattern('ـ')).toBe('');
  });
});
