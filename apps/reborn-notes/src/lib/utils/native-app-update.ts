import { get } from 'svelte/store';
import { toastStore } from '@reborn/ui';
import { createLogger } from '@reborn/utils';
import {
  defaultStoreUrl,
  desktopUpdatePlatform,
  evaluateUpdateSeverity,
  parseAppConfig,
  type NativePlatform
} from '@reborn/platform';
import { getCapacitorAppInfo } from '@reborn/platform/native';
import { t } from '$lib/stores/i18n.store';
import { API_BASE } from '$lib/utils/api-base';
import { appUpdateStore } from '$lib/stores/app-update.store';

// No top-level side effects (logger included) - this module is imported
// unconditionally by +layout.svelte and must stay fully treeshakeable from
// the web bundle (same rule as native-auth-storage / native-master-key-vault).

// Resume events can fire in quick bursts (app-switcher hops); the thresholds
// change rarely, so one round-trip per interval is plenty.
const CHECK_MIN_INTERVAL_MS = 15 * 60 * 1000;
let lastCheckAt = 0;
let recommendedToastShown = false;

/** What the gate needs to know about the running shell. */
interface ShellBuild {
  platform: NativePlatform;
  /** Build number (versionCode / CFBundleVersion); NaN when unreadable. */
  build: number;
  /** Bundle / package id, for the store URL fallback ('' when unknown). */
  appId: string;
}

/** Capacitor shells: the App plugin. Other Capacitor platforms have no gate. */
async function readCapacitorShell(): Promise<ShellBuild | null> {
  const info = await getCapacitorAppInfo();
  const { platform } = info;
  if (platform !== 'android' && platform !== 'ios') return null;
  return { platform, build: Number.parseInt(info.build, 10), appId: info.id };
}

/** Desktop shell: its own `app_info` command (version, build, system). */
async function readDesktopShell(): Promise<ShellBuild | null> {
  const { getDesktopAppInfo } = await import('./desktop-app-info');
  const info = await getDesktopAppInfo();
  const platform = desktopUpdatePlatform(info?.platform ?? null);
  if (!info || !platform) return null;
  return { platform, build: Number.parseInt(info.build, 10), appId: '' };
}

/**
 * Native min-version gate, runtime half (Faza 5, plan D5; pure logic +
 * rationale in `app-update.ts` of `@reborn/platform`). Fetches
 * /api/app-config, compares the shell's own build number (App.getInfo on the
 * phones, `app_info` on desktop) locally
 * and flips appUpdateStore: 'required' renders the full-screen
 * UpdateRequiredGate, 'recommended' shows a one-per-session toast.
 *
 * Fail-open on ANY error: an offline shell must keep working - enforcement
 * only makes sense when the API is reachable anyway. A server without an entry
 * for this platform (e.g. before `macos` was added) also means no gate. Never
 * throws.
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
    // One branch per build: a constant ternary is what the bundler folds, so
    // the desktop bundle drops the Capacitor plugins and the Capacitor one
    // the shell's commands.
    const shell = await (__REBORN_DESKTOP__ ? readDesktopShell() : readCapacitorShell());
    if (!shell) return;

    const res = await fetch(`${API_BASE}/app-config`);
    if (!res.ok) return;
    const config = parseAppConfig(await res.json(), shell.platform);
    if (!config) return;

    const severity = evaluateUpdateSeverity(shell.build, config);
    const storeUrl = config.storeUrl ?? defaultStoreUrl(shell.platform, shell.appId);
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
                // External origin - Capacitor routes it to the system browser,
                // the desktop shell to the default app (external_links.rs).
                onClick: () => window.open(storeUrl, '_blank', 'noopener')
              }
            }
          : {})
      });
    }
  } catch (err) {
    createLogger('notes:app-update').debug('app-config check failed (fail-open)', err);
  }
}
