import { applyCapacitorStatusBarStyle } from '@reborn/platform/native';

/**
 * Status-bar icon styling for the native shells (PWA parity, part 2 of 2).
 *
 * Part 1 is the brand strip the root layout paints behind the transparent
 * system status bar (+layout.svelte). The shells target edge-to-edge
 * (enforced on Android 15+/16; iOS has always worked this way), where the
 * bar has no paintable background of its own - so this only flips the
 * system icons (clock, battery) to dark, keeping them readable on the brand
 * yellow. The bridge to Capacitor's built-in SystemBars plugin is
 * `applyCapacitorStatusBarStyle` in `@reborn/platform/native`.
 *
 * Fire-and-forget at boot: a failure leaves the theme-default icons -
 * cosmetic, never blocking. The web build folds `__REBORN_NATIVE__` to false
 * and drops the call.
 */
export async function applyNativeStatusBarStyle(): Promise<void> {
  // The desktop shell has no status bar (its title bar is painted by the
  // shell itself), and no Capacitor bridge to ask.
  if (!__REBORN_NATIVE__ || __REBORN_DESKTOP__) return;
  await applyCapacitorStatusBarStyle();
}
