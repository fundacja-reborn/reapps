/**
 * Closed set of folder icon KEYS (lucide icon names). Stored encrypted in the
 * folder's metadata bundle; components live in
 * `$lib/components/folders/folder-icon-components.ts` so this module stays
 * free of Svelte imports (the metadata codec and its tests use it).
 *
 * Order = order in the picker grid; new keys go at the end, so the icons
 * people already know stay where they were. None of these is directional, so
 * none needs the RTL mirror rule in packages/ui global.css.
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
  'leaf',
  'store',
  'warehouse',
  'landmark',
  'package',
  'gift',
  'gem',
  'id-card',
  'key-square',
  'shield',
  'shield-check',
  'stamp',
  'scroll-text',
  'notebook-pen',
  'pencil-ruler',
  'toolbox',
  'stethoscope',
  'chef-hat',
  'hamburger',
  'film',
  'moon',
  'tree-palm',
  'paw-print',
  'circle-star',
  // #642: grouped by theme within the block (contact, writing, time, money, ...).
  'mail',
  'at-sign',
  'phone',
  'monitor-smartphone',
  'globe',
  'languages',
  'file-text',
  'book-text',
  'book-heart',
  'library-big',
  'feather',
  'pencil-line',
  'paperclip',
  'pin',
  'image',
  'diagram-flow-vertical',
  'puzzle',
  'calendar-heart',
  'cake',
  'rotate-ccw-clock',
  'credit-card',
  'scale',
  'crown',
  'pill',
  'atom',
  'zap',
  'flame',
  'rose',
  'swords',
  'mosque',
  'church'
] as const;

export type FolderIconKey = (typeof FOLDER_ICONS)[number];

export function isFolderIcon(value: unknown): value is FolderIconKey {
  return typeof value === 'string' && (FOLDER_ICONS as readonly string[]).includes(value);
}
