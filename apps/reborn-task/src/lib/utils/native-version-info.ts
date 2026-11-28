import { createLogger } from '@reborn/utils';
import { parseBackendVersion } from '@reborn/platform';
import { getCapacitorAppInfo } from '@reborn/platform/native';
import { API_BASE } from '$lib/utils/api-base';

// No top-level side effects (logger included) - the settings page imports this
// module unconditionally and it must stay fully treeshakeable from the web
// bundle (same rule as native-app-update). The __REBORN_NATIVE__ guard lets
// the bundler drop the body, and the App plugin behind getCapacitorAppInfo,
// from the web build.

export interface NativeVersionInfo {
	/** Native shell marketing version, e.g. "1.0.0" (App.getInfo().version). */
	appVersion: string;
	/** Native build number, e.g. "2" (App.getInfo().build). */
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
		// res.json() reads the body; never infer an empty answer from
		// Content-Length in the native shell (guideline 36).
		const res = await fetch(`${API_BASE}/app-config`);
		if (!res.ok) return null;
		return parseBackendVersion(await res.json());
	} catch {
		return null;
	}
}

/**
 * Version detail for the native Settings "Information" block, the same block
 * re/notes shows (guideline 38 "Wersje w aplikacji natywnej"): the
 * store-installed version and build, plus the live backend version that the
 * component pairs with the frozen __APP_VERSION__.
 *
 * Web returns null (the single __APP_VERSION__ line already tells the whole
 * story there). Fail-soft: a failed backend fetch leaves backendVersion null
 * while the native version still renders; only a missing App plugin yields
 * null. Never throws.
 */
export async function getNativeVersionInfo(): Promise<NativeVersionInfo | null> {
	if (!__REBORN_NATIVE__) return null;
	try {
		const info = await getCapacitorAppInfo();
		return {
			appVersion: info.version,
			appBuild: info.build,
			backendVersion: await fetchBackendVersion()
		};
	} catch (err) {
		createLogger('task:version-info').debug('native version info failed (fail-soft)', err);
		return null;
	}
}
