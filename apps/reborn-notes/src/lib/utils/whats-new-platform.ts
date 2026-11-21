import type { ReleasePlatform } from '@reborn/i18n';

/**
 * Resolve the current platform for release-notes filtering. Web (and PWA) is
 * 'web'; the native shell reports 'android' / 'ios', the desktop shell its
 * system ('macos', later 'windows'). The __REBORN_NATIVE__ guard lets the
 * bundler drop the @capacitor/core import (and collapse this to the constant
 * 'web') from the web build, mirroring native-version-info.ts.
 */
let cached: ReleasePlatform | null = null;

export async function resolveWhatsNewPlatform(): Promise<ReleasePlatform> {
  if (cached) return cached;
  if (!__REBORN_NATIVE__) {
    cached = 'web';
    return cached;
  }
  // One branch per build (a constant ternary is what the bundler folds).
  cached = await (__REBORN_DESKTOP__ ? resolveDesktopPlatform() : resolveCapacitorPlatform());
  return cached;
}

async function resolveCapacitorPlatform(): Promise<ReleasePlatform> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    const p = Capacitor.getPlatform();
    return p === 'android' || p === 'ios' ? p : 'web';
  } catch {
    return 'web';
  }
}

async function resolveDesktopPlatform(): Promise<ReleasePlatform> {
  const { getDesktopAppInfo } = await import('./desktop-app-info');
  // An unknown answer keeps the web filter, as before the shell reported it.
  return (await getDesktopAppInfo())?.platform ?? 'web';
}
