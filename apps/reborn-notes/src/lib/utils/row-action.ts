import type { Component } from 'svelte';

/**
 * A single action in a row's action menu. The same descriptor list feeds both
 * the desktop kebab (`DropdownMenu`) and the desktop right-click `ContextMenu`,
 * so the two menus can never drift: add or reorder an action in one place and
 * both surfaces update. Used by the note list, folder tree and tag list.
 */
export interface RowAction {
  /** Stable identity for `{#each}` keying. */
  key: string;
  /** Lucide icon component rendered before the label. */
  icon: Component<{ class?: string }>;
  /** Already-translated label. */
  label: string;
  /** Invoked when the item is chosen; receives the originating event. */
  run: (e?: Event) => void;
  /** Render with destructive (red) styling. */
  destructive?: boolean;
  /** Render a separator above this item. */
  separatorBefore?: boolean;
}
