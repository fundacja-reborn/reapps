/**
 * Status-bar icon styling for the native shells (PWA parity, part 2 of 2).
 *
 * Part 1 is the brand strip the root layout paints behind the transparent
 * system status bar (+layout.svelte). The shells target edge-to-edge
 * (enforced on Android 15+/16; iOS has always worked this way), where the
 * bar has no paintable background of its own - so this util only flips the
 * system icons (clock, battery) to dark, keeping them readable on the brand
 * yellow. Together they reproduce what Chrome renders for the installed PWA
 * from the `theme-color` meta (#FFD43B).
 *
 * Talks to Capacitor 8's BUILT-IN SystemBars plugin (compiled into
 * `@capacitor/android` / `@capacitor/ios` and auto-registered by the Bridge;
 * there is no npm package to import) through a raw `registerPlugin` proxy -
 * the same pattern as native-secure-storage.ts. 'LIGHT' means "light
 * background, use dark icons" on BOTH platforms (Android
 * `setAppearanceLightStatusBars(true)`, iOS `.darkContent`).
 * `bar: 'StatusBar'` scopes the call so the Android gesture bar keeps its
 * theme-following default; iOS reads only `style` and ignores the field.
 *
 * `@capacitor/core` is imported statically (boot-wedge lesson, guideline
 * 61); on web `registerPlugin` is referenced only behind the
 * compile-time-false `__REBORN_NATIVE__` guard, so the import tree-shakes
 * out of the web bundle (verified by the build grep).
 */

import { registerPlugin } from '@capacitor/core';

/** The plugin's method surface we use (see SystemBars.java / SystemBars.swift). */
interface SystemBarsPlugin {
  setStyle(options: { style: 'LIGHT' | 'DARK' | 'DEFAULT'; bar?: string }): Promise<void>;
}

/**
 * Dark status-bar icons over the brand band. Fire-and-forget at boot: a
 * failure leaves the theme-default icons - cosmetic, never blocking.
 */
export async function applyNativeStatusBarStyle(): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  try {
    const systemBars = registerPlugin<SystemBarsPlugin>('SystemBars');
    await systemBars.setStyle({ style: 'LIGHT', bar: 'StatusBar' });
  } catch {
    // Plugin missing or bridge hiccup: keep the default icons.
  }
}
