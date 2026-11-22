/**
 * `@capacitor/core` in the desktop (Tauri) build: `vite.config.ts` aliases the
 * package to this file when `NATIVE_SHELL=tauri`.
 *
 * Why: the Capacitor bridges (`native-secure-storage.ts`, `native-folder-fs.ts`,
 * `native-biometric-auth.ts`, `native-system-bars.ts`) import `registerPlugin`
 * statically - a dynamic import wedged the iOS boot (guideline 61). The desktop
 * build reaches those modules too (they hand out the desktop implementations),
 * and since `@capacitor/core` declares no `sideEffects: false`, the bundler kept
 * the whole package as a side-effect import, although nothing on desktop calls
 * it. The shell has no Capacitor bridge, so the package would only register
 * web fallbacks nobody uses.
 *
 * Only what the desktop module graph links is exported: `registerPlugin` (the
 * bridges above) and `WebPlugin` (the web fallbacks of `@capacitor/app` and
 * `@capacitor/network`, linked through dynamic imports in Capacitor-only
 * branches that the bundle then drops). Anything else from Capacitor in a
 * path the desktop build reaches fails the build ("not exported"). Both
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
