import { describe, it, expect, vi } from 'vitest';

// ── PDF line height for note fonts that need room (issue #546) ──────────────
// Reported by the Arabic translator on v0.53.0: lines in the PDF were closer
// than on screen and the marks of vocalized text in Amiri overlapped. The PDF
// multiplied its own, tighter line height (1.55) by a leading that is set
// against the editor's (1.7): 1.86 for Amiri, where its vocalized text is 2.0
// tall.
//
// The heavy service layer is faked the same way the sanitize spec fakes it
// (no IndexedDB / crypto in vitest) - we only need the module to load.

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ isAuthenticated: true, hasE2E: true }) };
});

vi.mock('@reborn/storage', () => ({
  noteStore: {},
  folderStore: {},
  tagStore: {},
  noteTagStore: {},
  noteTagOperations: {},
  noteTagQueries: {}
}));

vi.mock('./note.service', () => ({}));
vi.mock('./folder.service', () => ({}));
vi.mock('./tag.service', () => ({}));
vi.mock('./notes-sync.service', () => ({ pushNote: () => {}, pushPendingItems: () => {} }));
vi.mock('./note-index.svelte', () => ({ noteIndex: {} }));

import { pdfBodyLineHeight } from './export-import.service';
import {
  NOTE_ARABIC_FONTS,
  NOTE_FONTS,
  NOTE_FONT_FAMILIES,
  NOTE_FONT_LEADING_BASE,
  chosenNoteFontFamilies,
  type NoteFontPrefs
} from '$lib/utils/note-font';

const DEFAULTS: NoteFontPrefs = { noteFont: 'default', noteArabicFont: 'default' };

describe('pdfBodyLineHeight (#546)', () => {
  it('leaves the sheet as it was when no font asks for room', () => {
    expect(pdfBodyLineHeight()).toBe(1.55);
    expect(pdfBodyLineHeight(DEFAULTS)).toBe(1.55);
    expect(pdfBodyLineHeight({ noteFont: 'source-serif-4', noteArabicFont: 'tajawal' })).toBe(1.55);
  });

  it('gives Amiri and Noto Naskh Arabic the line height they have in the editor', () => {
    expect(pdfBodyLineHeight({ ...DEFAULTS, noteArabicFont: 'amiri' })).toBe(2.04);
    expect(pdfBodyLineHeight({ ...DEFAULTS, noteArabicFont: 'noto-naskh-arabic' })).toBe(1.87);
  });

  it('never sets a font tighter than its own line height, whatever the combination', () => {
    for (const noteFont of NOTE_FONTS) {
      for (const noteArabicFont of NOTE_ARABIC_FONTS) {
        const prefs: NoteFontPrefs = { noteFont, noteArabicFont };
        const lineHeight = pdfBodyLineHeight(prefs);
        expect(lineHeight, `${noteFont} + ${noteArabicFont}`).toBeGreaterThanOrEqual(1.55);
        for (const { family, leading } of chosenNoteFontFamilies(prefs)) {
          if (leading === undefined) continue;
          // The product is rounded to three places, hence the margin.
          expect(lineHeight, family).toBeGreaterThanOrEqual(
            NOTE_FONT_LEADING_BASE * leading - 0.001
          );
        }
      }
    }
    // The loop must have something to check.
    expect(Object.values(NOTE_FONT_FAMILIES).some((font) => font.leading !== undefined)).toBe(true);
  });
});
