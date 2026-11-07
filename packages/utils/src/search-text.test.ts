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

  it('folds the forms of alef into plain alef', () => {
    expect(foldSearchText('أحمد')).toBe('احمد');
    expect(foldSearchText('إسلام')).toBe('اسلام');
    expect(foldSearchText('آمن')).toBe('امن');
    expect(foldSearchText('ٱلله')).toBe('الله');
  });

  it('folds alef with a combining hamza like the precomposed letter', () => {
    expect(foldSearchText(`ا${String.fromCodePoint(0x0654)}حمد`)).toBe('احمد');
  });

  it('keeps letters that only look alike', () => {
    expect(foldSearchText('ي ى ه ة ئ ؤ ء')).toBe('ي ى ه ة ئ ؤ ء');
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

  it('lets every form of alef find every other form', () => {
    const forms = ['ا', 'أ', 'إ', 'آ', 'ٱ'];
    for (const query of forms) {
      for (const text of forms) {
        expect(new RegExp(searchPattern(`${query}حمد`)).test(`${text}حمد`)).toBe(true);
      }
    }
  });

  it('matches a form of alef with its marks and keeps the original text', () => {
    expect(new RegExp(searchPattern('اسلام')).exec('دين إِسلام')?.[0]).toBe('إِسلام');
  });

  it('keeps letters that only look alike apart', () => {
    expect(new RegExp(searchPattern('علي')).test('على')).toBe(false);
    expect(new RegExp(searchPattern('مدرسه')).test('مدرسة')).toBe(false);
    expect(new RegExp(searchPattern('سائل')).test('سايل')).toBe(false);
  });

  it('keeps literal characters between Arabic words', () => {
    expect(new RegExp(searchPattern('كتاب (جديد)')).test('كِتَاب (جَدِيد)')).toBe(true);
  });

  it('is empty for a query of marks alone', () => {
    expect(searchPattern('َُِ')).toBe('');
    expect(searchPattern('ـ')).toBe('');
  });
});
