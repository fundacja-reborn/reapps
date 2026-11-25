/**
 * Boot-time cosmetics of the re/task native shell: dropping the held splash
 * and the status-bar icon style. Both are inert on web: `__REBORN_NATIVE__` is
 * a build-time `false`, so the calls (and the plugins behind them in
 * `@reborn/platform/native`) are dead-code-eliminated.
 */
import { applyCapacitorStatusBarStyle, hideCapacitorSplash } from '@reborn/platform/native';

/**
 * Drop the held system splash (the SplashScreen plugin keeps it past the first
 * frame, `plugins.SplashScreen` in capacitor.config.ts). +layout.svelte calls
 * this once the shell can paint, so a cold start goes splash -> app without the
 * intermediate #app-loading spinner. Fire-and-forget and idempotent; a failure
 * leaves the config's `launchShowDuration` auto-hide in charge.
 */
export async function hideNativeSplash(): Promise<void> {
	if (__REBORN_NATIVE__) await hideCapacitorSplash();
}

/**
 * Status-bar icons over the brand band +layout.svelte paints behind the
 * transparent system bar (PWA parity). re/task's brand green (#43a047) takes
 * LIGHT icons - the contrast rule Chrome applies to the installed PWA's
 * `theme-color` (white on #43a047 is 3.3:1, above its 3:1 threshold) - so the
 * bar style is 'DARK' ("dark background"). re/notes' yellow takes the
 * opposite. Cosmetic fire-and-forget at boot.
 */
export async function applyNativeStatusBarStyle(): Promise<void> {
	if (__REBORN_NATIVE__) await applyCapacitorStatusBarStyle('DARK');
}
