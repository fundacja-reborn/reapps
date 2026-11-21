/**
 * Typed access to the Tauri bridge of the desktop shell (D0 spike).
 *
 * The shell injects its JS API as `window.__TAURI__` before any page script
 * runs (`app.withGlobalTauri` in `src-tauri/tauri.conf.json`), and each plugin
 * hangs its own API off that object (`__TAURI__.http` for the HTTP plugin). The
 * spike reads the global instead of importing `@tauri-apps/api`, so it adds no
 * npm dependency; only the members used here are typed.
 *
 * Desktop-only: every caller sits behind `__REBORN_DESKTOP__`, so this module
 * is dead-code-eliminated from the web and Capacitor bundles.
 */

/** The slice of `window.__TAURI__` the app uses. */
export interface DesktopBridge {
  core: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  /** Present when the shell registered `tauri-plugin-http`. */
  http?: {
    fetch: typeof fetch;
  };
}

/** The bridge, or `null` outside the desktop shell (or if injection failed). */
export function getDesktopBridge(): DesktopBridge | null {
  const bridge = (globalThis as { __TAURI__?: DesktopBridge }).__TAURI__;
  return bridge ?? null;
}

/** Call a Rust command of the shell. Rejects when the bridge is missing. */
export function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = getDesktopBridge();
  if (!bridge) return Promise.reject(new Error('desktop bridge unavailable'));
  return bridge.core.invoke<T>(command, args);
}
