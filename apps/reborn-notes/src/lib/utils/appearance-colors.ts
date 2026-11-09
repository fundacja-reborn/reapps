/**
 * Closed color palette for user-chosen appearance (folder color today; the
 * note color mark is meant to reuse it).
 *
 * The same eight hues as the tag palette (`TAG_COLORS` in tag.service.ts), but
 * stored as a KEY, never as a hex value: the shade is picked per theme at
 * render time, so the palette can be tuned later without rewriting any
 * stored (encrypted) data. Tags keep their stored hex values.
 *
 * Shades are chosen for WCAG 1.4.11 (non-text contrast, 3:1) when the color
 * draws an icon: light theme 600 (yellow 700 - yellow 600 is only ~2.9:1 on
 * white), dark theme 400, checked against the plain backgrounds AND the
 * accent background of a selected/hovered row (#f5f5f5 / #404040). The tag
 * palette's 500 shades fail that bar (yellow 1.9:1 on white).
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
  orange: 'text-orange-600 dark:text-orange-400',
  yellow: 'text-yellow-700 dark:text-yellow-400',
  green: 'text-green-600 dark:text-green-400',
  blue: 'text-blue-600 dark:text-blue-400',
  violet: 'text-violet-600 dark:text-violet-400',
  pink: 'text-pink-600 dark:text-pink-400',
  gray: 'text-gray-600 dark:text-gray-400'
};

/** Swatch fill per key - the same shades, so a swatch matches the icon it produces. */
export const APPEARANCE_SWATCH_CLASS: Record<AppearanceColor, string> = {
  red: 'bg-red-600 dark:bg-red-400',
  orange: 'bg-orange-600 dark:bg-orange-400',
  yellow: 'bg-yellow-700 dark:bg-yellow-400',
  green: 'bg-green-600 dark:bg-green-400',
  blue: 'bg-blue-600 dark:bg-blue-400',
  violet: 'bg-violet-600 dark:bg-violet-400',
  pink: 'bg-pink-600 dark:bg-pink-400',
  gray: 'bg-gray-600 dark:bg-gray-400'
};

/** Text class for a stored key; `undefined` for no color or a key this build does not know. */
export function appearanceTextClass(color: string | undefined): string | undefined {
  return isAppearanceColor(color) ? APPEARANCE_TEXT_CLASS[color] : undefined;
}
