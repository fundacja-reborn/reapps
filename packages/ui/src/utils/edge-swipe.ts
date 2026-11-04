// Structurally the same as @reborn/i18n's TextDirection. Not imported: no
// plain .ts module in @reborn/ui imports a workspace package, because the
// package's `tsc --build` would then pull that package's sources under its
// rootDir. Svelte components (not seen by tsc) import @reborn/i18n freely.
type TextDirection = 'ltr' | 'rtl';

/**
 * Direction-aware helpers for the mobile "swipe from the edge to go back"
 * gesture. The gesture starts at the inline-start edge and moves towards
 * inline-end: left -> right in LTR, right -> left in RTL (the platform
 * convention on iOS and Android in RTL locales).
 */

/** Distance in px between a touch and the inline-start edge of the viewport. */
export function distanceFromInlineStart(
  clientX: number,
  viewportWidth: number,
  dir: TextDirection
): number {
  return dir === 'rtl' ? viewportWidth - clientX : clientX;
}

/** Horizontal movement towards inline-end in px (negative = towards start). */
export function inlineDelta(startX: number, endX: number, dir: TextDirection): number {
  const dx = endX - startX;
  return dir === 'rtl' ? -dx : dx;
}
