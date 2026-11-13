/**
 * Note font (issue #546): the font of note content on this device, chosen
 * separately for Latin and for Arabic script. Both can be active at once -
 * each @font-face carries a `unicode-range`, so the browser picks the font per
 * character and a mixed Arabic / English note gets both.
 *
 * The choice is exposed to CSS as `--rn-note-font` on <html> (next to
 * `--rn-note-scale`) and read by the Live Preview editor, the rendered preview
 * and the note title. The interface keeps its own font, and so does the raw
 * Markdown editor (monospace).
 *
 * The font files are declared in `src/styles/note-fonts.css` and are fetched
 * on demand, never pre-cached - see the note there.
 */

/** Latin-script choices; `default` = the app font (Roboto). */
export const NOTE_FONTS = ['default', 'source-serif-4'] as const;
export type NoteFont = (typeof NOTE_FONTS)[number];

/** Arabic-script choices; `default` = whatever Arabic font the system has. */
export const NOTE_ARABIC_FONTS = ['default', 'amiri', 'noto-naskh-arabic', 'tajawal'] as const;
export type NoteArabicFont = (typeof NOTE_ARABIC_FONTS)[number];

export const DEFAULT_NOTE_FONT = 'default';

export interface NoteFontPrefs {
  noteFont: NoteFont;
  noteArabicFont: NoteArabicFont;
}

export interface NoteFontFace {
  weight: number;
  style: 'normal' | 'italic';
}

export interface NoteFontFamily {
  /** CSS family name, as declared in `note-fonts.css`. Also the label in Settings. */
  family: string;
  /** One entry per @font-face weight/style pair (a variable font counts once). */
  faces: readonly NoteFontFace[];
  /**
   * Characters that touch every subset file of the family, so loading the
   * faces with this text fetches all of its files (see {@link loadNoteFonts}).
   */
  probe: string;
  /**
   * `size-adjust` of every @font-face of the family in `note-fonts.css`, in
   * percent (left out = 100). Naskh letters are small for their em square, so
   * at the same font size they read smaller than the Latin text next to them.
   */
  sizeAdjust?: number;
  /**
   * Line-height multiplier for note content while this font is chosen (left
   * out = 1). A fixed line height does not follow the font, and vocalized
   * Arabic (marks above and below the letters) needs more room than Latin
   * text: without it the marks of one line run into the next. Set so that the
   * editor's line height is about the font's own designed line height at its
   * adjusted size.
   */
  leading?: number;
}

const STATIC_FACES: readonly NoteFontFace[] = [
  { weight: 400, style: 'normal' },
  { weight: 700, style: 'normal' }
];

const ARABIC_PROBE = '\u{0627}';

export const NOTE_FONT_FAMILIES: Record<
  Exclude<NoteFont, 'default'> | Exclude<NoteArabicFont, 'default'>,
  NoteFontFamily
> = {
  'source-serif-4': {
    family: 'Source Serif 4',
    faces: [
      { weight: 400, style: 'normal' },
      { weight: 400, style: 'italic' },
      { weight: 700, style: 'normal' },
      { weight: 700, style: 'italic' }
    ],
    // "a" is in the latin subset, "ą" (U+0105) in latin-ext.
    probe: 'a\u{0105}'
  },
  // Sizes and leading asked for by the Arabic translator after v0.52.0 (#546).
  // Measured against the files we ship: at the same font size a line of Amiri
  // is 11% shorter than the same line in Noto Naskh Arabic, and the alef of
  // Noto Naskh Arabic is 0.67em against Roboto's 0.75em ascenders. The fonts'
  // own line heights (ascent + descent) are 1.76em and 1.70em; times the size
  // adjustment that is 2.02 and 1.87, which is the editor's 1.7 times the
  // leading below.
  amiri: {
    family: 'Amiri',
    faces: STATIC_FACES,
    probe: ARABIC_PROBE,
    sizeAdjust: 115,
    leading: 1.2
  },
  'noto-naskh-arabic': {
    family: 'Noto Naskh Arabic',
    // One variable file covers 400-700.
    faces: [{ weight: 400, style: 'normal' }],
    probe: ARABIC_PROBE,
    sizeAdjust: 110,
    leading: 1.1
  },
  tajawal: { family: 'Tajawal', faces: STATIC_FACES, probe: ARABIC_PROBE }
};

/**
 * The font stack of note content when nothing is chosen. Mirrors `--font-sans`
 * in app.css (a Tailwind `@theme inline` value, so not available as a runtime
 * CSS variable).
 */
export const NOTE_FONT_BASE_STACK =
  "'Roboto', ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'";

export function isNoteFont(value: unknown): value is NoteFont {
  return (NOTE_FONTS as readonly unknown[]).includes(value);
}

export function isNoteArabicFont(value: unknown): value is NoteArabicFont {
  return (NOTE_ARABIC_FONTS as readonly unknown[]).includes(value);
}

/** The chosen families, Latin first; empty when both are at the default. */
export function chosenNoteFontFamilies(prefs: NoteFontPrefs): NoteFontFamily[] {
  const chosen: NoteFontFamily[] = [];
  if (prefs.noteFont !== DEFAULT_NOTE_FONT) chosen.push(NOTE_FONT_FAMILIES[prefs.noteFont]);
  if (prefs.noteArabicFont !== DEFAULT_NOTE_FONT) {
    chosen.push(NOTE_FONT_FAMILIES[prefs.noteArabicFont]);
  }
  return chosen;
}

/**
 * The CSS `font-family` value for note content: the chosen families in front
 * of `base`. `null` when both choices are at the default, so callers can leave
 * their own CSS untouched.
 */
export function noteFontStack(
  prefs: NoteFontPrefs,
  base: string = NOTE_FONT_BASE_STACK
): string | null {
  const chosen = chosenNoteFontFamilies(prefs);
  if (chosen.length === 0) return null;
  return [...chosen.map((font) => `'${font.family}'`), base].join(', ');
}

/**
 * The line-height multiplier the chosen fonts ask for (1 when none does). It
 * applies to all note content of the device, not only to lines in that script:
 * CSS has one line height per block, whatever characters a line holds.
 */
export function noteFontLeading(prefs: NoteFontPrefs): number {
  return Math.max(1, ...chosenNoteFontFamilies(prefs).map((font) => font.leading ?? 1));
}

/**
 * The line height the `leading` values are set against: the editor's
 * (`.cm-content` in NoteEditor.svelte). Times a font's leading it is that
 * font's own line height at its adjusted size.
 */
export const NOTE_FONT_LEADING_BASE = 1.7;

/**
 * The line height body text needs in the chosen fonts, as a multiple of the
 * font size; `null` when no chosen font asks for extra room.
 *
 * For a surface that sets body text tighter than the editor does (the PDF
 * export): its own line height times the leading stays below the font's own
 * line height, and the marks of vocalized Arabic run into the next line
 * (issue #546, reported for Amiri in PDF). Such a surface takes the larger of
 * its own line height and this one.
 */
export function noteFontLineHeight(prefs: NoteFontPrefs): number | null {
  const leading = noteFontLeading(prefs);
  if (leading === 1) return null;
  return Math.round(NOTE_FONT_LEADING_BASE * leading * 1000) / 1000;
}

/**
 * Writes the note font onto `<html>` as `--rn-note-font`. At the default the
 * variable is removed, so every consumer falls back to its own font.
 */
export function applyNoteFont(root: HTMLElement, prefs: NoteFontPrefs): void {
  const stack = noteFontStack(prefs);
  if (stack === null) {
    root.style.removeProperty('--rn-note-font');
  } else {
    root.style.setProperty('--rn-note-font', stack);
  }
}

/**
 * Loads the files of the chosen fonts and resolves once they are usable (or
 * failed - a font that cannot be fetched just falls back, it never throws).
 *
 * Without `text`, every file of each chosen family is fetched (all subsets,
 * weights and styles). The root layout does this on start and on every change,
 * so a font picked while online is complete in the service worker's cache and
 * keeps working offline, instead of missing e.g. its bold face until some
 * note happens to need it. With `text`, only the faces that text needs are
 * loaded - used before a PDF export, where the layout must not be measured
 * with a fallback font.
 */
export async function loadNoteFonts(prefs: NoteFontPrefs, text?: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const sample = text === undefined ? undefined : [...new Set(text)].join('');
  const loads: Promise<unknown>[] = [];
  for (const font of chosenNoteFontFamilies(prefs)) {
    for (const face of font.faces) {
      loads.push(
        document.fonts.load(
          `${face.style} ${face.weight} 1em '${font.family}'`,
          sample ?? font.probe
        )
      );
    }
  }
  await Promise.allSettled(loads);
}
