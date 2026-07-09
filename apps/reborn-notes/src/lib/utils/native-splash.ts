/**
 * Native splash-screen handoff (cold-start UX, third phase after PR #433/#434).
 *
 * The Capacitor SplashScreen plugin holds the system splash past the
 * activity's first frame (capacitor.config.ts `plugins.SplashScreen`), so the
 * intermediate #app-loading spinner screen from app.html never paints on
 * native: the cold-start sequence becomes splash -> populated UI. This util
 * drops the splash the moment the shell can actually paint - +layout.svelte
 * calls it when `appReady` (populated first paint, guideline 61 Fix 7) or the
 * 2s `initTimeout` safety net flips.
 *
 * Dead-man's switch lives in the CONFIG, not here: `launchAutoHide: true`
 * with a generous `launchShowDuration` means that if the JS bundle never
 * executes (corrupt install, webview crash), the plugin's own timeout drops
 * the splash instead of leaving it stuck forever - the documented risk of
 * `launchAutoHide: false`, which has no native fallback on either platform.
 *
 * Fire-and-forget: a failed hide() leaves the auto-hide timeout in charge -
 * cosmetic, never blocking. Safe to call repeatedly (hide() no-ops once the
 * splash is gone) and on every boot path: unauth / App-Lock boots flip
 * appReady fast, so their screens come up straight from the splash, masked by
 * the config's fade-out. The dynamic import sits INSIDE the positive
 * `if (__REBORN_NATIVE__)` block (same pattern as `$lib/utils/clipboard.ts`,
 * verified by build grep) so the web build dead-code-eliminates both the
 * branch and the plugin - boot-wedge lesson, guideline 61.
 */
export async function hideNativeSplash(): Promise<void> {
  if (__REBORN_NATIVE__) {
    try {
      const { SplashScreen } = await import('@capacitor/splash-screen');
      await SplashScreen.hide();
    } catch {
      // Plugin missing or bridge hiccup: launchShowDuration auto-hide covers it.
    }
  }
}
