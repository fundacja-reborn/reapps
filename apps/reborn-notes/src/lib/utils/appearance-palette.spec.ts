import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  APPEARANCE_COLORS,
  APPEARANCE_SWATCH_CLASS,
  APPEARANCE_TEXT_CLASS,
  appearanceTextClass,
  isAppearanceColor
} from './appearance-colors';
import { FOLDER_ICONS, isFolderIcon } from './folder-icons';

/**
 * The palette and the icon set are closed sets stored as keys in encrypted
 * folder metadata. These pins keep the parts that must move together in
 * step: theme classes and labels (the key -> component map is a full
 * Record, so svelte-check guards it).
 */

const enNotes = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../packages/i18n/src/translations/notes/en.json'),
    'utf-8'
  )
);

describe('appearance palette', () => {
  it('has a theme-aware text and swatch class for every color', () => {
    for (const color of APPEARANCE_COLORS) {
      expect(APPEARANCE_TEXT_CLASS[color]).toMatch(/^text-\S+ dark:text-\S+$/);
      expect(APPEARANCE_SWATCH_CLASS[color]).toMatch(/^bg-\S+ dark:bg-\S+$/);
    }
  });

  it('uses shades that clear 3:1 as an icon color (no 500-level tag shades)', () => {
    for (const cls of Object.values(APPEARANCE_TEXT_CLASS)) {
      expect(cls).not.toMatch(/-500\b/);
    }
  });

  it('maps unknown or absent keys to no class (default rendering)', () => {
    expect(appearanceTextClass(undefined)).toBeUndefined();
    expect(appearanceTextClass('teal')).toBeUndefined();
    expect(appearanceTextClass('#ef4444')).toBeUndefined();
    expect(appearanceTextClass('blue')).toBe(APPEARANCE_TEXT_CLASS.blue);
    expect(isAppearanceColor('gray')).toBe(true);
  });

  it('has a translated name for every color (screen-reader label)', () => {
    for (const color of APPEARANCE_COLORS) {
      expect(typeof enNotes.colors[color]).toBe('string');
    }
  });
});

describe('folder icon set', () => {
  it('has no duplicates and recognizes only its own keys', () => {
    expect(new Set(FOLDER_ICONS).size).toBe(FOLDER_ICONS.length);
    expect(isFolderIcon('briefcase')).toBe(true);
    expect(isFolderIcon('rocket')).toBe(false);
    expect(isFolderIcon(undefined)).toBe(false);
  });

  it('has a translated label for every icon', () => {
    for (const icon of FOLDER_ICONS) {
      expect(typeof enNotes.folders.appearance.icons[icon]).toBe('string');
    }
  });
});
