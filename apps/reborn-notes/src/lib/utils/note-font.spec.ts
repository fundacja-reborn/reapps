// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOTE_FONT_BASE_STACK,
  applyNoteFont,
  chosenNoteFontFamilies,
  loadNoteFonts,
  noteFontLeading,
  noteFontStack,
  type NoteFontPrefs
} from './note-font';

/**
 * Note font of this device (issue #546): the font stack built from the Latin
 * and the Arabic choice, how it reaches CSS, and how the font files are loaded.
 */

const DEFAULTS: NoteFontPrefs = { noteFont: 'default', noteArabicFont: 'default' };

function stubFonts(load: (font: string, text?: string) => Promise<unknown>) {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
}

/** A `document.fonts.load` stand-in that records its calls. */
function fontLoader() {
  return vi.fn<(font: string, text?: string) => Promise<unknown>>(() => Promise.resolve([]));
}

afterEach(() => {
  document.documentElement.removeAttribute('style');
  Reflect.deleteProperty(document, 'fonts');
});

describe('noteFontStack', () => {
  it('is null at the default, so callers leave their own CSS alone', () => {
    expect(noteFontStack(DEFAULTS)).toBeNull();
    expect(chosenNoteFontFamilies(DEFAULTS)).toEqual([]);
  });

  it('puts the chosen Latin font in front of the app font stack', () => {
    expect(noteFontStack({ ...DEFAULTS, noteFont: 'source-serif-4' })).toBe(
      `'Source Serif 4', ${NOTE_FONT_BASE_STACK}`
    );
  });

  it('adds an Arabic font on its own, keeping the app font for Latin text', () => {
    expect(noteFontStack({ ...DEFAULTS, noteArabicFont: 'noto-naskh-arabic' })).toBe(
      `'Noto Naskh Arabic', ${NOTE_FONT_BASE_STACK}`
    );
  });

  it('uses both at once, Latin first (mixed notes get each script its font)', () => {
    expect(noteFontStack({ noteFont: 'source-serif-4', noteArabicFont: 'amiri' })).toBe(
      `'Source Serif 4', 'Amiri', ${NOTE_FONT_BASE_STACK}`
    );
  });

  it('accepts another base stack (the PDF export keeps its system fonts)', () => {
    expect(noteFontStack({ ...DEFAULTS, noteArabicFont: 'tajawal' }, 'system-ui, sans-serif')).toBe(
      "'Tajawal', system-ui, sans-serif"
    );
  });
});

describe('noteFontLeading (#546)', () => {
  it('is 1 at the default and for fonts that fit the usual line height', () => {
    expect(noteFontLeading(DEFAULTS)).toBe(1);
    expect(noteFontLeading({ noteFont: 'source-serif-4', noteArabicFont: 'tajawal' })).toBe(1);
  });

  it('gives the Naskh fonts more room, whatever the Latin font is', () => {
    expect(noteFontLeading({ ...DEFAULTS, noteArabicFont: 'amiri' })).toBe(1.2);
    expect(
      noteFontLeading({ noteFont: 'source-serif-4', noteArabicFont: 'noto-naskh-arabic' })
    ).toBe(1.1);
  });
});

describe('applyNoteFont', () => {
  it('writes nothing at the default', () => {
    applyNoteFont(document.documentElement, DEFAULTS);
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });

  it('sets --rn-note-font and removes it again at the default', () => {
    const root = document.documentElement;
    applyNoteFont(root, { noteFont: 'source-serif-4', noteArabicFont: 'amiri' });
    expect(root.style.getPropertyValue('--rn-note-font')).toBe(
      `'Source Serif 4', 'Amiri', ${NOTE_FONT_BASE_STACK}`
    );
    applyNoteFont(root, DEFAULTS);
    expect(root.style.getPropertyValue('--rn-note-font')).toBe('');
  });
});

describe('loadNoteFonts', () => {
  it('fetches nothing at the default', async () => {
    const load = fontLoader();
    stubFonts(load);
    await loadNoteFonts(DEFAULTS);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads every face of the chosen fonts with a text that touches each subset file', async () => {
    const load = fontLoader();
    stubFonts(load);
    await loadNoteFonts({ noteFont: 'source-serif-4', noteArabicFont: 'amiri' });
    expect(load.mock.calls).toEqual([
      ["normal 400 1em 'Source Serif 4'", 'a\u{0105}'],
      ["italic 400 1em 'Source Serif 4'", 'a\u{0105}'],
      ["normal 700 1em 'Source Serif 4'", 'a\u{0105}'],
      ["italic 700 1em 'Source Serif 4'", 'a\u{0105}'],
      ["normal 400 1em 'Amiri'", '\u{0627}'],
      ["normal 700 1em 'Amiri'", '\u{0627}']
    ]);
  });

  it('loads a variable font once', async () => {
    const load = fontLoader();
    stubFonts(load);
    await loadNoteFonts({ ...DEFAULTS, noteArabicFont: 'noto-naskh-arabic' });
    expect(load.mock.calls.map(([font]) => font)).toEqual(["normal 400 1em 'Noto Naskh Arabic'"]);
  });

  it('with a text, asks only for what that text needs (each character once)', async () => {
    const load = fontLoader();
    stubFonts(load);
    await loadNoteFonts({ ...DEFAULTS, noteArabicFont: 'tajawal' }, 'abba abba');
    expect(load.mock.calls).toEqual([
      ["normal 400 1em 'Tajawal'", 'ab '],
      ["normal 700 1em 'Tajawal'", 'ab ']
    ]);
  });

  it('never throws when a font cannot be fetched (offline, never cached)', async () => {
    stubFonts(() => Promise.reject(new Error('network')));
    await expect(
      loadNoteFonts({ noteFont: 'source-serif-4', noteArabicFont: 'amiri' })
    ).resolves.toBeUndefined();
  });

  it('does nothing where the Font Loading API is missing', async () => {
    await expect(loadNoteFonts({ ...DEFAULTS, noteArabicFont: 'amiri' })).resolves.toBeUndefined();
  });
});
