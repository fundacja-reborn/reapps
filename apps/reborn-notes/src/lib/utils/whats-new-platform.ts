import type { ReleasePlatform } from '@reborn/i18n';

/**
 * Resolve the current platform for release-notes filtering. Web (and PWA) is
 * 'web'; the native shell reports 'android' / 'ios'. The __REBORN_NATIVE__ guard
 * lets the bundler drop the @capacitor/core import (and collapse this to the
 * constant 'web') from the web build, mirroring native-version-info.ts.
 */
let cached: ReleasePlatform | null = null;

export async function resolveWhatsNewPlatform(): Promise<ReleasePlatform> {
  if (cached) return cached;
  if (!__REBORN_NATIVE__) {
    cached = 'web';
    return cached;
  }
  try {
    const { Capacitor } = await import('@capacitor/core');
    const p = Capacitor.getPlatform();
    cached = p === 'android' || p === 'ios' ? p : 'web';
  } catch {
    cached = 'web';
  }
  return cached;
}
