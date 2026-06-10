/**
 * Runtime platform selector for reborn-notes.
 *
 * Web is the default. The native branch (and its Capacitor plugins, behind
 * `./native`) is selected only when `__REBORN_NATIVE__` is true, so the whole
 * `./native` module is dead-code-eliminated from the web bundle - keeping the
 * web runtime unchanged.
 *
 * Capability home: `@reborn/platform` (interface + web impls). See
 * `docs/development/planning/native-faza3-plan.md`.
 */
import { base } from '$app/paths';
import { getConnectivity } from '@reborn/api-client';
import { createWebPlatform, type Platform } from '@reborn/platform';
import { createNativePlatform } from './native';

// Web connectivity: the same active HTTP probe as before, bound to this app's
// same-origin `/api/health`. On native this is replaced by device network state
// (see ./native), so the probe endpoint is web-only.
const webPlatform = (): Platform =>
  createWebPlatform({ network: getConnectivity({ endpoint: `${base}/api/health` }) });

export const platform: Platform = __REBORN_NATIVE__ ? createNativePlatform() : webPlatform();
