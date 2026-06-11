import { get } from 'svelte/store';
import { toastStore } from '@reborn/ui';
import { createLogger } from '@reborn/utils';
import { t } from '$lib/stores/i18n.store';
import { API_BASE } from '$lib/utils/api-base';
import { appUpdateStore } from '$lib/stores/app-update.store';
import {
  defaultStoreUrl,
  evaluateUpdateSeverity,
  parseAppConfig,
  type NativePlatform
} from '$lib/utils/app-update';

const logger = createLogger('notes:app-update');

// Resume events can fire in quick bursts (app-switcher hops); the thresholds
// change rarely, so one round-trip per interval is plenty.
const CHECK_MIN_INTERVAL_MS = 15 * 60 * 1000;
let lastCheckAt = 0;
let recommendedToastShown = false;

/**
 * Native min-version gate, runtime half (Faza 5, plan D5; pure logic +
 * rationale in app-update.ts). Fetches /api/app-config, compares the shell's
 * own build number (App.getInfo) locally and flips appUpdateStore:
 * 'required' renders the full-screen UpdateRequiredGate, 'recommended' shows
 * a one-per-session toast.
 *
 * Fail-open on ANY error: an offline shell must keep working - enforcement
 * only makes sense when the API is reachable anyway. Never throws.
 *
 * Called deferred after boot and on resume from +layout.svelte. The dynamic
 * plugin imports are safe here precisely because this never runs on the hot
 * startup path (guideline 61 boot-wedge rule).
 */
export async function checkNativeUpdateGate(): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  const now = Date.now();
  if (now - lastCheckAt < CHECK_MIN_INTERVAL_MS) return;
  lastCheckAt = now;

  try {
    const [{ App }, { Capacitor }] = await Promise.all([
      import('@capacitor/app'),
      import('@capacitor/core')
    ]);
    const platformName = Capacitor.getPlatform();
    if (platformName !== 'android' && platformName !== 'ios') return;
    const platform: NativePlatform = platformName;

    const info = await App.getInfo();
    const currentBuild = Number.parseInt(info.build, 10);

    const res = await fetch(`${API_BASE}/app-config`);
    if (!res.ok) return;
    const config = parseAppConfig(await res.json(), platform);
    if (!config) return;

    const severity = evaluateUpdateSeverity(currentBuild, config);
    const storeUrl = config.storeUrl ?? defaultStoreUrl(platform, info.id);
    appUpdateStore.set({ severity, storeUrl });

    if (severity === 'recommended' && !recommendedToastShown) {
      recommendedToastShown = true;
      const $t = get(t);
      toastStore.info($t('app.update_gate.recommended_title'), {
        description: $t('app.update_gate.recommended_description'),
        ...(storeUrl
          ? {
              action: {
                label: $t('app.update_gate.open_store'),
                // External origin - Capacitor routes it to the system browser.
                onClick: () => window.open(storeUrl, '_blank', 'noopener')
              }
            }
          : {})
      });
    }
  } catch (err) {
    logger.debug('app-config check failed (fail-open)', err);
  }
}
