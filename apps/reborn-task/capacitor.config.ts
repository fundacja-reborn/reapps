import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the re/task native shell (same setup as re/notes).
 *
 * The shell bundles the SAME client build as the PWA, emitted as a static SPA
 * (see `build-native*` in project.json + `BUILD_TARGET=native` in
 * svelte.config.js) and loaded locally from a custom scheme. Loading code
 * locally - never over the network - is the whole point: it is the structural
 * mitigation of CORE-12.
 *
 * STORE IDENTITY - PERMANENT once published:
 * - appId: Android package name / iOS bundle id. Cannot ever change after the
 *   first store release (it IS the app's identity in both stores, and the value
 *   referenced by assetlinks.json / apple-app-site-association).
 * - androidScheme: the webview origin (https://localhost) keys IndexedDB and
 *   localStorage. Changing it after release silently resets every install's
 *   local state. 'https' from the start (re/notes switched from the spike's
 *   'http' before its v1).
 *
 * Cross-origin API: the app talks to the origin baked into PUBLIC_API_BASE_URL
 * at build time. Transport is CapacitorHttp (native layer), so no cookies or
 * server CORS are involved; native auth is token-based (refresh token in the
 * Keychain / Keystore, /api/auth/refresh-native).
 */
// Loud sync-time banner: forgetting CAP_DEV_CLEARTEXT for an emulator/localprod
// sync produces a shell that refuses the plain-http backend (every API call
// fails with ERR_CONNECTION_REFUSED -> "Sync error"). The reverse mistake (dev
// flag in a release sync) is the dangerous one.
if (process.env.CAP_DEV_CLEARTEXT === '1') {
	console.warn(
		'[capacitor.config] DEV cleartext ON - emulator/localprod sync. NEVER ship this sync to a store.'
	);
} else {
	console.warn(
		'[capacitor.config] cleartext OFF (release mode). For emulator/localprod runs: CAP_DEV_CLEARTEXT=1 npx cap sync android'
	);
}

const config: CapacitorConfig = {
	appId: 'eu.reapps.task',
	appName: 're/task',
	webDir: 'build-native',
	server: {
		androidScheme: 'https',
		// Cleartext HTTP is for LOCAL DEV ONLY: emulator/simulator builds talk to
		// the host's localprod backend over plain http (10.0.2.2 / localhost).
		// Read at `cap sync` time - a local run needs CAP_DEV_CLEARTEXT=1 in the
		// environment; a release sync MUST run without it, so the shipped shell is
		// HTTPS-only (the release AndroidManifest overlay enforces it as well).
		cleartext: process.env.CAP_DEV_CLEARTEXT === '1'
	},
	plugins: {
		CapacitorHttp: { enabled: true },
		// Hold the system splash past the activity's first frame so a cold start
		// goes splash -> app, with no intermediate #app-loading spinner. The web
		// layer hides it once the app-ready gate opens
		// (src/lib/utils/native-shell.ts). launchAutoHide stays TRUE on purpose:
		// the generous duration is the native dead-man's switch when the JS
		// bundle never executes (launchAutoHide: false has no native fallback).
		SplashScreen: {
			launchShowDuration: 6000,
			launchAutoHide: true,
			launchFadeOutDuration: 200
		}
	}
};

export default config;
