/**
 * One-shot Capacitor bridges shared by the native shells: splash, status-bar
 * icons, clipboard, share sheet, file export and the shell's own version.
 *
 * Every function talks to Capacitor only; the apps decide when a build uses
 * them (behind `__REBORN_NATIVE__`, with the desktop shell's own variants
 * under `__REBORN_DESKTOP__`), so the web bundle drops this module.
 *
 * Plugin packages are imported dynamically inside each function - none of
 * these run on the hot startup path (boot-wedge rule, guideline 61). The one
 * exception is the built-in SystemBars plugin, reached through the static
 * `registerPlugin` proxy like the secure-storage bridge.
 */

import { registerPlugin } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Splash
// ---------------------------------------------------------------------------

/**
 * Drop the held system splash (cold-start handoff, guideline 61 "Trzecia
 * faza"). The SplashScreen plugin holds it past the activity's first frame
 * (`plugins.SplashScreen` in capacitor.config.ts); the app calls this the
 * moment the shell can paint. Fire-and-forget and idempotent: a failed hide()
 * leaves the config's `launchShowDuration` auto-hide in charge - the native
 * dead-man's switch when the JS bundle never runs.
 */
export async function hideCapacitorSplash(): Promise<void> {
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    // Plugin missing or bridge hiccup: launchShowDuration auto-hide covers it.
  }
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

/** The method surface we use (see SystemBars.java / SystemBars.swift). */
interface SystemBarsPlugin {
  setStyle(options: { style: 'LIGHT' | 'DARK' | 'DEFAULT'; bar?: string }): Promise<void>;
}

/**
 * Status-bar icon colour over the brand band the app paints behind the
 * transparent system bar (PWA parity, guideline 61 "Brandowy status bar").
 * `style` names the BACKGROUND, as the plugin does: 'LIGHT' (re/notes'
 * yellow) gives dark icons, 'DARK' (re/task's green) light ones - on both
 * platforms.
 *
 * Talks to Capacitor 8's BUILT-IN SystemBars plugin (compiled into
 * `@capacitor/android` / `@capacitor/ios`, auto-registered by the Bridge;
 * there is no npm package) through a raw `registerPlugin` proxy.
 * `bar: 'StatusBar'` leaves the Android gesture bar on its theme-following
 * default. Cosmetic fire-and-forget at boot: a failure keeps the default icons.
 */
export async function applyCapacitorStatusBarStyle(
  style: 'LIGHT' | 'DARK' = 'LIGHT'
): Promise<void> {
  try {
    const systemBars = registerPlugin<SystemBarsPlugin>('SystemBars');
    await systemBars.setStyle({ style, bar: 'StatusBar' });
  } catch {
    // Plugin missing or bridge hiccup: keep the default icons.
  }
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/**
 * Copy through the OS clipboard (`@capacitor/clipboard`, the native
 * ClipboardManager). The web Clipboard API and `execCommand('copy')` are both
 * unreliable inside the Android WebView - they report success without writing
 * (Faza 3b smoke) - so the shells never use them. Returns true on success.
 */
export async function copyTextCapacitor(text: string): Promise<boolean> {
  try {
    const { Clipboard } = await import('@capacitor/clipboard');
    await Clipboard.write({ string: text });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Share sheet
// ---------------------------------------------------------------------------

export interface ShareLinkOptions {
  url: string;
  title?: string;
  dialogTitle?: string;
}

/**
 * Open the OS share sheet for a link (`@capacitor/share`).
 *
 * Zero-Knowledge note: a public share link carries its decryption key in the
 * URL fragment (`#k=...`) by design - it is exactly what copying the link
 * shares. The URL is never logged here.
 *
 * `true` means the sheet was presented (the user may still cancel - that is
 * success, not a failure); `false` means sharing is unavailable or the plugin
 * failed, so the caller should fall back to the clipboard.
 */
export async function shareLinkCapacitor(opts: ShareLinkOptions): Promise<boolean> {
  try {
    const { Share } = await import('@capacitor/share');
    const can = await Share.canShare().catch(() => ({ value: true }));
    if (!can.value) return false;
    try {
      await Share.share({
        title: opts.title,
        url: opts.url,
        dialogTitle: opts.dialogTitle
      });
    } catch {
      // The sheet was presented; a throw here is a user cancel or a transient
      // OS hiccup. Treat as handled - do NOT fall back to clipboard (that
      // would surprise a user who deliberately dismissed the sheet).
    }
    return true;
  } catch {
    // Plugin missing / failed to load - let the caller fall back to clipboard.
    return false;
  }
}

// ---------------------------------------------------------------------------
// File export
// ---------------------------------------------------------------------------

/**
 * Subdirectory of the cache dir that exports are written to.
 *
 * Android only shares what the FileProvider path map declares, and each
 * shell's map is scoped to exactly this directory - see
 * `android/app/src/main/res/xml/file_paths.xml` in both apps (audit 014 N2).
 * Renaming it here without renaming it there makes Share.share() throw
 * "Failed to find configured root that contains ..." on Android.
 */
export const EXPORT_SUBDIR = 'exports';

/** Read a Blob as Base64 (no `data:` prefix) - the format the shell bridges take. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('blob read failed'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Export a file from a Capacitor shell: write it to the app cache directory
 * and hand it to the system share sheet ("Save to Files", AirDrop, mail...).
 *
 * WKWebView silently ignores `<a download>` clicks on blob: URLs (Faza 4
 * smoke), so the web download helper cannot work in the iOS shell; the share
 * sheet is also the better mobile export UX, so both phones use this path.
 * Dismissing the sheet is a user choice, not an error.
 */
export async function shareFileFromCache(filename: string, base64Data: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  // No `encoding` option: the Filesystem plugin treats the payload as base64
  // and writes the decoded bytes. Cache directory: OS-managed and reclaimable,
  // never backed up - the file only needs to outlive the share sheet.
  // `recursive` creates EXPORT_SUBDIR on first use; the plugin defaults it to
  // false and then fails the write with a missing-parent-directory error.
  const { uri } = await Filesystem.writeFile({
    path: `${EXPORT_SUBDIR}/${filename}`,
    data: base64Data,
    directory: Directory.Cache,
    recursive: true
  });

  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title: filename, files: [uri] });
  } catch (error) {
    // Dismissing the share sheet rejects with a "canceled" error - that is a
    // user choice, not a failure; the write above already succeeded.
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('cancel')) return;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Shell version
// ---------------------------------------------------------------------------

/** What a Capacitor shell reports about itself (`App.getInfo()` + platform). */
export interface CapacitorAppInfo {
  /** Marketing version, e.g. "1.0.0" (versionName / CFBundleShortVersionString). */
  version: string;
  /** Build number as reported, e.g. "1" (versionCode / CFBundleVersion). */
  build: string;
  /** Package / bundle id, e.g. "eu.reapps.task". */
  id: string;
  /** `Capacitor.getPlatform()`: 'android' | 'ios' | 'web'. */
  platform: string;
}

/**
 * The running shell's version and identity. Throws when the App plugin is
 * missing - callers are fail-soft wrappers (version display, update gate).
 */
export async function getCapacitorAppInfo(): Promise<CapacitorAppInfo> {
  const [{ App }, { Capacitor }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/core')
  ]);
  const info = await App.getInfo();
  return {
    version: info.version,
    build: info.build,
    id: info.id,
    platform: Capacitor.getPlatform()
  };
}
