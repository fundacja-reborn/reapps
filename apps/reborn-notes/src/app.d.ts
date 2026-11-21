// See https://svelte.dev/docs/kit/types#app
// for information about these interfaces

declare global {
  const __APP_VERSION__: string;
  /** Build-time native (Capacitor) flag. `false` on web (see vite.config.ts define). */
  const __REBORN_NATIVE__: boolean;
  /**
   * Build-time desktop (Tauri) flag. `true` only on the `build-desktop*`
   * targets, where `__REBORN_NATIVE__` is true as well (see vite.config.ts).
   */
  const __REBORN_DESKTOP__: boolean;

  namespace App {
    interface Error {
      isOffline?: boolean;
    }
    interface Locals {
      userId?: string;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

declare module '$env/static/public' {
  export const PUBLIC_BASE_PATH: string;
}

export {};
