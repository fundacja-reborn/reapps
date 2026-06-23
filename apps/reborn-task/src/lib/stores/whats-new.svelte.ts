/**
 * Shared open-state for the global "What's new" dialog mounted once in the root
 * layout. A tiny rune store so both the post-update toast and the Settings row
 * can open the same dialog instance from anywhere in the app.
 */
export const whatsNew = $state<{ open: boolean }>({ open: false });

export function openWhatsNew(): void {
  whatsNew.open = true;
}
