/**
 * `@capacitor/core` in the desktop (Tauri) build: `vite.config.ts` aliases the
 * package to this file when `NATIVE_SHELL=tauri`.
 *
 * Why: the Capacitor bridges (`@reborn/platform/native`, `native-folder-fs.ts`,
 * `native-biometric-auth.ts`) import `registerPlugin` statically - a dynamic
 * import wedged the iOS boot (guideline 61). The desktop build reaches those
 * modules too (the `$lib` wrappers hand out the desktop implementations),
 * and since `@capacitor/core` declares no `sideEffects: false`, the bundler kept
 * the whole package as a side-effect import, although nothing on desktop calls
 * it. The shell has no Capacitor bridge, so the package would only register
 * web fallbacks nobody uses.
 *
 * Only what the desktop module graph links is exported: `registerPlugin` (the
 * bridges above), `WebPlugin` (the web fallbacks of the plugins the shared
 * Capacitor bridges load - app, network, clipboard, share, splash-screen,
 * filesystem - linked through dynamic imports in Capacitor-only functions
 * that the bundle then drops) and `buildRequestInit` (imported by the
 * filesystem web fallback, linked the same way). Anything else from Capacitor
 * in a path the desktop build reaches fails the build ("not exported"). All
 * throw when used: a call at runtime means a desktop branch is missing.
 */

export function registerPlugin(name: string): never {
  throw new Error(`Capacitor plugin "${name}" is not part of the desktop shell`);
}

export class WebPlugin {
  constructor() {
    throw new Error('Capacitor web plugins are not part of the desktop shell');
  }
}

export function buildRequestInit(): never {
  throw new Error('Capacitor HTTP helpers are not part of the desktop shell');
}
