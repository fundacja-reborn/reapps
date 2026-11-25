import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

declare const __APP_VERSION__: string;

/**
 * Public, unauthenticated app metadata for the re/task NATIVE shells (same
 * contract as re/notes' /api/app-config, Faza 5 plan D5).
 *
 * Native builds cannot be hot-updated (the store-only update channel is the
 * CORE-12 mitigation), so the server needs a way to tell outdated shells to
 * update. The client compares its own build number (App.getInfo) against
 * these thresholds LOCALLY and deliberately sends nothing back - no version
 * header, no telemetry. `version` is the live backend version, shown in the
 * native Settings next to the frozen bundled frontend version (guideline 38).
 * Web clients never call this endpoint.
 *
 * Env (all optional; 0 / unset = no enforcement). Prefixed TASK_ because both
 * apps read the same .env and their store builds are numbered independently
 * (re/notes reads the unprefixed NATIVE_*):
 *   TASK_NATIVE_MIN_BUILD_ANDROID / TASK_NATIVE_MIN_BUILD_IOS
 *     build number (versionCode / CURRENT_PROJECT_VERSION) below which the
 *     shell shows a hard "update required" gate.
 *   TASK_NATIVE_RECOMMENDED_BUILD_ANDROID / _IOS
 *     below which the shell shows a one-per-session "update available" toast.
 *   TASK_NATIVE_STORE_URL_ANDROID / _IOS
 *     store listing URL override. Android falls back to the Play listing
 *     derived client-side from the package id; iOS has no derivable URL
 *     (numeric App Store id), so its update button hides until this is set.
 *
 * No DB, no auth, static per process - as cheap as /api/health.
 */

const toBuild = (raw: string | undefined): number => {
	const parsed = Number.parseInt(raw ?? '', 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const platformConfig = (suffix: 'ANDROID' | 'IOS') => ({
	min_build: toBuild(env[`TASK_NATIVE_MIN_BUILD_${suffix}`]),
	recommended_build: toBuild(env[`TASK_NATIVE_RECOMMENDED_BUILD_${suffix}`]),
	store_url: env[`TASK_NATIVE_STORE_URL_${suffix}`] || null
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
