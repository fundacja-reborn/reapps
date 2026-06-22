import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

declare const __APP_VERSION__: string;

/**
 * Public, unauthenticated app metadata for NATIVE clients (Faza 5, plan D5).
 *
 * Native builds cannot be hot-updated (the store-only update channel is the
 * CORE-12 mitigation), so the server needs a way to tell outdated shells to
 * update. The client compares its own build number (App.getInfo) against
 * these thresholds LOCALLY and deliberately sends nothing back - no version
 * header, no telemetry - consistent with the no-PII posture. The trade-off is
 * accepted: the server cannot observe the client-version distribution before
 * raising a threshold. Web clients never call this endpoint.
 *
 * `version` is the live backend monorepo version (same value as
 * /api/health.version). Native Settings shows it next to the frozen bundled
 * frontend version so the user can see how far the store build has drifted
 * from the server (guideline 38 "Wersje w aplikacji natywnej"). Serving it
 * here lets the native client read thresholds and backend version in one
 * round-trip. Still zero client telemetry - it is a plain GET.
 *
 * Env (all optional; 0 / unset = no enforcement):
 *   NATIVE_MIN_BUILD_ANDROID / NATIVE_MIN_BUILD_IOS
 *     build number (versionCode / CURRENT_PROJECT_VERSION) below which the
 *     shell shows a hard "update required" gate.
 *   NATIVE_RECOMMENDED_BUILD_ANDROID / NATIVE_RECOMMENDED_BUILD_IOS
 *     below which the shell shows a one-per-session "update available" toast.
 *   NATIVE_STORE_URL_ANDROID / NATIVE_STORE_URL_IOS
 *     store listing URL override. Android falls back to the Play listing
 *     derived client-side from the package id; iOS has no derivable URL
 *     (numeric App Store id), so the update button hides until this is set.
 *
 * No DB, no auth, static per process - as cheap as /api/health.
 */

const toBuild = (raw: string | undefined): number => {
	const parsed = Number.parseInt(raw ?? '', 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const platformConfig = (suffix: 'ANDROID' | 'IOS') => ({
	min_build: toBuild(env[`NATIVE_MIN_BUILD_${suffix}`]),
	recommended_build: toBuild(env[`NATIVE_RECOMMENDED_BUILD_${suffix}`]),
	store_url: env[`NATIVE_STORE_URL_${suffix}`] || null
});

export const GET: RequestHandler = () =>
	json({
		success: true,
		data: {
			version: __APP_VERSION__,
			native: {
				android: platformConfig('ANDROID'),
				ios: platformConfig('IOS')
			}
		}
	});
