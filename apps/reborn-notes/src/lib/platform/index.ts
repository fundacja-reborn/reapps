/**
 * Runtime platform selector for reborn-notes.
 *
 * Web is the default. The Capacitor branch (`createCapacitorPlatform` from
 * `@reborn/platform/native`, shared with re/task) is selected only when
 * `__REBORN_NATIVE__` is true, so it is dead-code-eliminated from the web
 * bundle - keeping the web runtime unchanged.
 *
 * Capability home: `@reborn/platform` (interface + web impls) and
 * `@reborn/platform/native` (Capacitor impls). See guideline 61.
 */
import { base } from '$app/paths';
import { getConnectivity } from '@reborn/api-client';
import { createWebPlatform, type Platform } from '@reborn/platform';
import { createCapacitorPlatform } from '@reborn/platform/native';
import { createDesktopPlatform } from './desktop';

// Web connectivity: the same active HTTP probe as before, bound to this app's
// same-origin `/api/health`. On Capacitor this is replaced by device network
// state; the desktop shell probes the remote API (./desktop).
const webPlatform = (): Platform =>
  createWebPlatform({ network: getConnectivity({ endpoint: `${base}/api/health` }) });

// The desktop (Tauri) shell is a native build without the Capacitor bridge, so
// it is checked first; each build keeps exactly one implementation.
export const platform: Platform = __REBORN_DESKTOP__
  ? createDesktopPlatform()
  : __REBORN_NATIVE__
    ? createCapacitorPlatform()
    : webPlatform();
