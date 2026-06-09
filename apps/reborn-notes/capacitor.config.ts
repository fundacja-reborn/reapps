import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the Reborn Notes native shell (Faza 0 spike).
 *
 * The shell bundles the SAME client build as the PWA, emitted as a static SPA
 * (see `build:native` in project.json + `BUILD_TARGET=native` in svelte.config.js)
 * and loaded locally from a custom scheme. Loading code locally - never over the
 * network - is the whole point: it is the structural mitigation of CORE-12.
 *
 * Provisional values for the spike (NOT a store release):
 * - appId: reverse-DNS placeholder; finalize before the first store submission
 *   (it is effectively permanent once published).
 * - androidScheme 'http' -> assets served from http://localhost, which counts as
 *   a secure context, so Web Crypto (AES-GCM/PBKDF2) and WASM (Argon2id) work.
 *
 * Cross-origin API: the app talks to https://staging.reapps.eu/api. That fetch
 * is governed by CORS on the server, so staging must allow the native origin
 * (Access-Control-Allow-Origin: http://localhost). See the spike runbook for
 * that prerequisite and the CapacitorHttp fallback.
 */
const config: CapacitorConfig = {
  appId: 'eu.reapps.notes',
  appName: 're/notes',
  webDir: 'build-native',
  server: {
    androidScheme: 'http'
    // Faza 0 fallback if you cannot add CORS to staging: route fetch/XHR through
    // the native layer (bypasses CORS). Representative architecture uses real
    // CORS instead, so this stays off by default.
    // plugins: { CapacitorHttp: { enabled: true } }
  }
};

export default config;
