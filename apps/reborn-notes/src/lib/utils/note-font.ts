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
  amiri: { family: 'Amiri', faces: STATIC_FACES, probe: ARABIC_PROBE },
  'noto-naskh-arabic': {
    family: 'Noto Naskh Arabic',
    // One variable file covers 400-700.
    faces: [{ weight: 400, style: 'normal' }],
    probe: ARABIC_PROBE
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
