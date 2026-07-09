import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the Reborn Notes native shell.
 *
 * The shell bundles the SAME client build as the PWA, emitted as a static SPA
 * (see `build-native*` in project.json + `BUILD_TARGET=native` in
 * svelte.config.js) and loaded locally from a custom scheme. Loading code
 * locally - never over the network - is the whole point: it is the structural
 * mitigation of CORE-12.
 *
 * STORE IDENTITY - PERMANENT (finalized in Faza 5):
 * - appId: Android package name / iOS bundle id. Cannot ever change once the
 *   app is published (it IS the app's identity in both stores, and the value
 *   referenced by assetlinks.json / apple-app-site-association).
 * - androidScheme: the webview origin (https://localhost) keys IndexedDB and
 *   localStorage. Changing it after release silently resets every install's
 *   local state (the Keystore-held master key and refresh token survive, but
 *   users would re-sync from scratch). 'https' is Capacitor's default; the
 *   Faza 0 spike used 'http' temporarily - switched back before v1, while the
 *   only installs are dev devices.
 *
 * Cross-origin API: the app talks to the origin baked into PUBLIC_API_BASE_URL
 * at build time. Transport is CapacitorHttp (native layer, decided in Faza 1),
 * so no cookies or server CORS are involved; native auth is token-based
 * (Faza 2).
 */
// Loud sync-time banner: forgetting CAP_DEV_CLEARTEXT for an emulator/localprod
// sync produces a shell that refuses the plain-http backend (every API call
// fails with ERR_CONNECTION_REFUSED -> "Sync error") - tripped on 2026-06-11.
// The reverse mistake (dev flag in a release sync) is the dangerous one.
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
  appId: 'eu.reapps.notes',
  appName: 're/notes',
  webDir: 'build-native',
  server: {
    androidScheme: 'https',
    // Cleartext HTTP is for LOCAL DEV ONLY: emulator/simulator builds talk to
    // the host's localprod backend over plain http (10.0.2.2 / localhost).
    // Read at `cap sync` time - sync for a local run needs CAP_DEV_CLEARTEXT=1
    // in the environment; a release sync MUST run without it, so the shipped
    // shell is HTTPS-only. See the release runbook (guideline 62).
    cleartext: process.env.CAP_DEV_CLEARTEXT === '1'
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    // Hold the system splash past the activity's first frame so a cold start
    // goes splash -> populated UI, with no intermediate #app-loading spinner
    // (guideline 61, third cold-start phase). The web layer hides it early at
    // appReady/initTimeout (src/lib/utils/native-splash.ts) - typically well
    // under launchShowDuration. launchAutoHide stays TRUE on purpose: the
    // generous duration is the native dead-man's switch when the JS bundle
    // never executes (corrupt install / webview crash); launchAutoHide: false
    // has no native fallback and would strand the splash forever.
    SplashScreen: {
      launchShowDuration: 6000,
      launchAutoHide: true,
      launchFadeOutDuration: 200
    }
  }
};

export default config;
