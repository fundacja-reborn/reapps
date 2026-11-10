import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
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

// ── Contrast helpers ─────────────────────────────────────────────────────
// Tailwind v4 defines its palette in oklch; the ratios are computed from
// those exact values (theme.css of the installed version), so a Tailwind
// upgrade that shifts a shade is caught here. Out-of-gamut values are
// clipped to sRGB - close to what an sRGB screen shows.

const tailwindTheme = readFileSync(
  createRequire(import.meta.url).resolve('tailwindcss/theme.css'),
  'utf-8'
);

function oklchLuminance(l: number, c: number, h: number): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (x: number) => Math.min(1, Math.max(0, x));
  const r = clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const bl = clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

/** Luminance of a Tailwind color token such as `orange-700`. */
function tailwindLuminance(token: string): number {
  const match = tailwindTheme.match(
    new RegExp(`--color-${token}:\\s*oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`)
  );
  if (!match) throw new Error(`Tailwind color ${token} not found`);
  return oklchLuminance(Number(match[1]) / 100, Number(match[2]), Number(match[3]));
}

function hexLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

const grayLuminance = (l: number) => oklchLuminance(l, 0, 0);

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** `bg-orange-700 dark:bg-orange-400` -> { light: 'orange-700', dark: 'orange-400' } */
function shadesOf(cls: string): { light: string; dark: string } {
  const [light, dark] = cls.split(' ').map((part) => part.replace(/^(dark:)?(bg|text)-/, ''));
  return { light, dark };
}

// Backgrounds the color is drawn on (packages/ui global.css, notes app.css):
// page / sidebar, folder rows (accent = hover and selected), note rows
// (.note-item-bg, its hover, .list-row-active). Selection mode tints a row
// with bg-primary/10, which lands between these values.
const LIGHT_BACKGROUNDS: Record<string, number> = {
  page: grayLuminance(1),
  sidebar: grayLuminance(0.98),
  'folder row accent': grayLuminance(0.95),
  'note row': hexLuminance('#f2f2f2'),
  'note row hover': hexLuminance('#e8e8e8'),
  'note row open': hexLuminance('#ededed')
};
const DARK_BACKGROUNDS: Record<string, number> = {
  page: grayLuminance(0.145),
  sidebar: grayLuminance(0.17),
  'folder row accent': grayLuminance(0.371),
  'note row': grayLuminance(0.269),
  'note row hover': grayLuminance(0.371),
  'note row open': grayLuminance(0.32)
};

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

  it('draws the same shade as an icon (folder) and as a swatch / dot (note)', () => {
    for (const color of APPEARANCE_COLORS) {
      expect(shadesOf(APPEARANCE_SWATCH_CLASS[color])).toEqual(
        shadesOf(APPEARANCE_TEXT_CLASS[color])
      );
    }
  });

  // WCAG 1.4.11: the folder icon and the note dot carry meaning by color, so
  // each shade needs 3:1 against every background it is drawn on.
  it('clears 3:1 on every row background in both themes', () => {
    const failures: string[] = [];
    for (const color of APPEARANCE_COLORS) {
      const { light, dark } = shadesOf(APPEARANCE_SWATCH_CLASS[color]);
      for (const [name, bg] of Object.entries(LIGHT_BACKGROUNDS)) {
        const ratio = contrast(tailwindLuminance(light), bg);
        if (ratio < 3) failures.push(`${light} on light ${name}: ${ratio.toFixed(2)}`);
      }
      for (const [name, bg] of Object.entries(DARK_BACKGROUNDS)) {
        const ratio = contrast(tailwindLuminance(dark), bg);
        if (ratio < 3) failures.push(`${dark} on dark ${name}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
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
