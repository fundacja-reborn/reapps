/**
 * Closed color palette for user-chosen appearance: the folder color (icon
 * tint) and the note color mark (dot before the title in the note list).
 *
 * The same eight hues as the tag palette (`TAG_COLORS` in tag.service.ts), but
 * stored as a KEY, never as a hex value: the shade is picked per theme at
 * render time, so the palette can be tuned later without rewriting any
 * stored (encrypted) data. Tags keep their stored hex values.
 *
 * Shades are chosen for WCAG 1.4.11 (non-text contrast, 3:1) on every
 * background the color is drawn on: plain, hovered and selected rows of the
 * folder tree and of the note list, in both themes (the gray note rows,
 * #f2f2f2 / #e8e8e8 / #ededed, are the hardest). Light theme 600, except
 * orange, yellow and green at 700 (their 600 shades fall to 2.6-2.9:1 on
 * gray rows); dark theme 400. `appearance-palette.spec.ts` computes these
 * ratios from Tailwind's own color values. The tag palette's 500 shades
 * fail that bar (yellow 1.9:1 on white).
 *
 * Every class below is a complete literal so Tailwind's source scan emits it.
 */

export const APPEARANCE_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'violet',
  'pink',
  'gray'
] as const;

export type AppearanceColor = (typeof APPEARANCE_COLORS)[number];

export function isAppearanceColor(value: unknown): value is AppearanceColor {
  return typeof value === 'string' && (APPEARANCE_COLORS as readonly string[]).includes(value);
}

/** Text (icon stroke) color per key, theme-aware. */
export const APPEARANCE_TEXT_CLASS: Record<AppearanceColor, string> = {
  red: 'text-red-600 dark:text-red-400',
  orange: 'text-orange-700 dark:text-orange-400',
  yellow: 'text-yellow-700 dark:text-yellow-400',
  green: 'text-green-700 dark:text-green-400',
  blue: 'text-blue-600 dark:text-blue-400',
  violet: 'text-violet-600 dark:text-violet-400',
  pink: 'text-pink-600 dark:text-pink-400',
  gray: 'text-gray-600 dark:text-gray-400'
};

/** Swatch fill per key - the same shades, so a swatch matches the icon it produces. */
export const APPEARANCE_SWATCH_CLASS: Record<AppearanceColor, string> = {
  red: 'bg-red-600 dark:bg-red-400',
  orange: 'bg-orange-700 dark:bg-orange-400',
  yellow: 'bg-yellow-700 dark:bg-yellow-400',
  green: 'bg-green-700 dark:bg-green-400',
  blue: 'bg-blue-600 dark:bg-blue-400',
  violet: 'bg-violet-600 dark:bg-violet-400',
  pink: 'bg-pink-600 dark:bg-pink-400',
  gray: 'bg-gray-600 dark:bg-gray-400'
};

/** Text class for a stored key; `undefined` for no color or a key this build does not know. */
export function appearanceTextClass(color: string | undefined): string | undefined {
  return isAppearanceColor(color) ? APPEARANCE_TEXT_CLASS[color] : undefined;
}
