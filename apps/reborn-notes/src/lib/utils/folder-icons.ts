/**
 * Closed set of folder icon KEYS (lucide icon names). Stored encrypted in the
 * folder's metadata bundle; components live in
 * `$lib/components/folders/folder-icon-components.ts` so this module stays
 * free of Svelte imports (the metadata codec and its tests use it).
 *
 * Order = order in the picker grid. None of these is directional, so none
 * needs the RTL mirror rule in packages/ui global.css.
 *
 * Adding a key is safe; REMOVING one is not - folders that use it would fall
 * back to the default icon on this build (unknown keys render as the plain
 * folder and are kept in the bundle, never rewritten).
 */
export const FOLDER_ICONS = [
  'briefcase',
  'house',
  'user',
  'users',
  'heart',
  'star',
  'book-open',
  'graduation-cap',
  'lightbulb',
  'code',
  'wrench',
  'calendar',
  'square-check',
  'archive',
  'bookmark',
  'music',
  'camera',
  'plane',
  'shopping-cart',
  'utensils',
  'dumbbell',
  'wallet',
  'lock',
  'leaf'
] as const;

export type FolderIconKey = (typeof FOLDER_ICONS)[number];

export function isFolderIcon(value: unknown): value is FolderIconKey {
  return typeof value === 'string' && (FOLDER_ICONS as readonly string[]).includes(value);
}
