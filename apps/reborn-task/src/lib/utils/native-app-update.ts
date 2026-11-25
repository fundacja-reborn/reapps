import { get } from 'svelte/store';
import { toastStore } from '@reborn/ui';
import { createLogger } from '@reborn/utils';
import { defaultStoreUrl, evaluateUpdateSeverity, parseAppConfig } from '@reborn/platform';
import { getCapacitorAppInfo } from '@reborn/platform/native';
import { t } from '$lib/stores/i18n.store';
import { API_BASE } from '$lib/utils/api-base';
import { appUpdateStore } from '$lib/stores/app-update.store';

// No top-level side effects (logger included) - this module is imported
// unconditionally by +layout.svelte and must stay fully treeshakeable from
// the web bundle.

// Resume events can fire in quick bursts (app-switcher hops); the thresholds
// change rarely, so one round-trip per interval is plenty.
const CHECK_MIN_INTERVAL_MS = 15 * 60 * 1000;
let lastCheckAt = 0;
let recommendedToastShown = false;

/**
 * Native min-version gate, runtime half (the same gate re/notes ships; pure
 * logic + rationale in `app-update.ts` of `@reborn/platform`). Fetches this
 * app's /api/app-config (TASK_NATIVE_* thresholds), compares the shell's own
 * build number (App.getInfo) locally and flips appUpdateStore: 'required'
 * renders the full-screen UpdateRequiredGate, 'recommended' shows a
 * one-per-session toast. Nothing is sent to the server (zero telemetry).
 *
 * Fail-open on ANY error: an offline shell must keep working - enforcement
 * only makes sense when the API is reachable anyway. Never throws.
 *
 * Called deferred after boot and on resume from +layout.svelte - never on the
 * hot startup path, which is why the dynamic plugin imports behind
 * getCapacitorAppInfo are safe here (guideline 61 boot-wedge rule).
 */
export async function checkNativeUpdateGate(): Promise<void> {
	if (!__REBORN_NATIVE__) return;
	const now = Date.now();
	if (now - lastCheckAt < CHECK_MIN_INTERVAL_MS) return;
	lastCheckAt = now;

	try {
		const shell = await getCapacitorAppInfo();
		const { platform } = shell;
		if (platform !== 'android' && platform !== 'ios') return;
		const build = Number.parseInt(shell.build, 10);

		const res = await fetch(`${API_BASE}/app-config`);
		if (!res.ok) return;
		const config = parseAppConfig(await res.json(), platform);
		if (!config) return;

		const severity = evaluateUpdateSeverity(build, config);
		const storeUrl = config.storeUrl ?? defaultStoreUrl(platform, shell.id);
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
		createLogger('task:app-update').debug('app-config check failed (fail-open)', err);
	}
}
