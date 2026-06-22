import { createLogger } from '@reborn/utils';
import { API_BASE } from '$lib/utils/api-base';
import { parseBackendVersion } from '$lib/utils/app-version';

// No top-level side effects (logger included) - this module is imported by the
// settings page but must stay fully treeshakeable from the web bundle (same
// rule as native-app-update / native-master-key-vault). The __REBORN_NATIVE__
// guard lets the bundler drop the body (and the dynamic @capacitor/app import)
// from the web build entirely.

export interface NativeVersionInfo {
  /** Native shell marketing version, e.g. "1.0.0" (App.getInfo().version). */
  appVersion: string;
  /** Native build number, e.g. "1" (App.getInfo().build). */
  appBuild: string;
  /**
   * Live backend monorepo version from /api/app-config, or null when the
   * server is unreachable (offline). The frozen bundled-frontend version is
   * __APP_VERSION__, read directly in the component - the gap between the two
   * is the drift the user is meant to see (guideline 38).
   */
  backendVersion: string | null;
}

async function fetchBackendVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/app-config`);
    if (!res.ok) return null;
    return parseBackendVersion(await res.json());
  } catch {
    return null;
  }
}

/**
 * Version detail for the native Settings "About" block (guideline 38 "Wersje w
 * aplikacji natywnej"). Returns the store-installed native version plus the
 * live backend version; the component pairs the backend version with the frozen
 * __APP_VERSION__ so the user sees how far the bundled client has drifted from
 * the server.
 *
 * Web returns null (the single __APP_VERSION__ line already tells the whole
 * story there). Fail-soft: a failed backend fetch leaves backendVersion null
 * but the native version still renders; only a missing App plugin yields null.
 * Never throws.
 */
export async function getNativeVersionInfo(): Promise<NativeVersionInfo | null> {
  if (!__REBORN_NATIVE__) return null;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return {
      appVersion: info.version,
      appBuild: info.build,
      backendVersion: await fetchBackendVersion()
    };
  } catch (err) {
    createLogger('notes:version-info').debug('native version info failed (fail-soft)', err);
    return null;
  }
}
