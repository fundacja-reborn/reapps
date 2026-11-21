/**
 * Typed access to the Tauri bridge of the desktop shell.
 *
 * The shell injects its JS API as `window.__TAURI__` before any page script
 * runs (`app.withGlobalTauri` in `src-tauri/tauri.conf.json`), and each plugin
 * hangs its own API off that object (`__TAURI__.http` for the HTTP plugin). The
 * app reads the global instead of importing `@tauri-apps/api` (decision of
 * 2026-11-21, D1): no npm dependency whose version would have to follow the
 * Rust `tauri` crate, and the shell's permissions are enforced in Rust either
 * way. Only the members used here are typed; the global has the same shape as
 * the npm package, so moving to it later is mechanical.
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
  /** Events from the Rust side (the app menu). */
  event?: {
    /** Resolves to the function that stops listening. */
    listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
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

/** System dialogs the shell has open right now (Touch ID, open / save panel). */
let openDialogs = 0;
const dialogClosedListeners = new Set<() => void>();

/**
 * Call a shell command that shows a system dialog: the unlock prompt, the
 * folder picker, "Save as...".
 *
 * Such a dialog takes the focus from the app window, so to the page it looks
 * exactly like the user switching to another app. The desktop lifecycle
 * (`$lib/platform/desktop.ts`) reads {@link isShellDialogOpen} to tell the two
 * apart; otherwise every Touch ID prompt would count as "left the app" for
 * App Lock and every export would trigger a sync on return.
 */
export async function invokeDesktopDialog<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  openDialogs += 1;
  try {
    return await invokeDesktop<T>(command, args);
  } finally {
    openDialogs -= 1;
    for (const listener of [...dialogClosedListeners]) listener();
  }
}

/** True while a dialog started by {@link invokeDesktopDialog} is open. */
export function isShellDialogOpen(): boolean {
  return openDialogs > 0;
}

/** Called each time such a dialog closes. Returns an unsubscribe. */
export function onShellDialogClosed(listener: () => void): () => void {
  dialogClosedListeners.add(listener);
  return () => {
    dialogClosedListeners.delete(listener);
  };
}
