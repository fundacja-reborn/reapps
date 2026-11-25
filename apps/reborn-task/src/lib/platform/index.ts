/**
 * Runtime platform selector for re/task.
 *
 * Web is the default. The Capacitor branch (`createCapacitorPlatform` from
 * `@reborn/platform/native`, shared with re/notes) is selected only when
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

// Web connectivity: the same active HTTP probe as before, bound to this app's
// same-origin `/api/health`. In the shell it is replaced by device network
// state - the local assets answer same-origin regardless of upstream there.
const webPlatform = (): Platform =>
	createWebPlatform({ network: getConnectivity({ endpoint: `${base}/api/health` }) });

// One branch per build (a constant ternary is what the bundler folds).
export const platform: Platform = __REBORN_NATIVE__ ? createCapacitorPlatform() : webPlatform();
