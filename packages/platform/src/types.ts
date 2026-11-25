/**
 * `@reborn/platform` - platform capability contract.
 *
 * The same client build runs as a web PWA and inside a Capacitor native shell.
 * A few capabilities differ between the two (connectivity, app lifecycle,
 * hardware back button), so the UI talks to these interfaces and a runtime
 * selector binds the web or native implementation. Web is the default; the
 * native branch is chosen only on the Capacitor build (see the app-level
 * `$lib/platform` selector, gated by `__REBORN_NATIVE__`).
 *
 * Design notes:
 * - The main entry (`@reborn/platform`) is intentionally dependency-free. The
 *   web connectivity store already lives in `@reborn/api-client`
 *   (`getConnectivity`), so the app injects it via `createWebPlatform({ network })`
 *   instead of the package hard-wiring a dependency - keeping the boundary clean
 *   and the build trivial.
 * - The Capacitor implementations live behind the separate `@reborn/platform/native`
 *   entry (promoted from re/notes when re/task became the second native app).
 *   Only that entry depends on Capacitor; it reads no build flags - the apps
 *   decide which implementation a build uses (`__REBORN_NATIVE__` /
 *   `__REBORN_DESKTOP__`), so the web bundle drops the native entry entirely.
 */

export type NetworkStatus = 'online' | 'offline' | 'unknown';

/** Reactive connectivity snapshot. Structurally matches api-client's `ConnectivityState`. */
export interface NetworkState {
  status: NetworkStatus;
  lastProbeAt: number | null;
}

/**
 * Reactive connectivity source. The web implementation is api-client's
 * `ConnectivityStore` (HTTP probe); the native one reads device network state
 * from `@capacitor/network`. The shape mirrors a Svelte-style readable store.
 */
export interface PlatformNetwork {
  /** Emits the current state synchronously, then on every change. Returns an unsubscribe. */
  subscribe(listener: (state: NetworkState) => void): () => void;
  /** Current state without subscribing. */
  getState(): NetworkState;
  /** Force a re-evaluation of connectivity. */
  refresh(): Promise<boolean>;
  /** Hint that a request just failed, so the source can re-check sooner. */
  markFailure(): void;
  /** Tear down listeners / timers. */
  destroy(): void;
}

/**
 * Foreground / background transitions. On web these map to `visibilitychange`;
 * on native to `@capacitor/app` `appStateChange`. The native shell has no
 * Service Worker, so resume is what drives "sync on return to foreground".
 */
export interface PlatformLifecycle {
  /** App returned to the foreground. Returns an unsubscribe. */
  onResume(handler: () => void): () => void;
  /** App went to the background. Returns an unsubscribe. */
  onPause(handler: () => void): () => void;
}

/**
 * System (hardware) back button. Web is a no-op - the browser / PWA history
 * stack already handles back. Native (Android) wires `@capacitor/app`
 * `backButton`.
 */
export interface PlatformBackButton {
  /**
   * Register a back handler that runs before the default behaviour. Return
   * `true` to consume the event (suppress the default). Pass `null` to clear.
   * Web ignores it.
   */
  setHandler(handler: (() => boolean) | null): void;
}

/**
 * Inbound deep links (Android App Links / iOS Universal Links). The native
 * shell wires `@capacitor/app` `appUrlOpen` plus the cold-start launch URL; web
 * is a no-op, because in a browser the URL is already the page being viewed -
 * there is no separate shell to route the link into.
 */
export interface PlatformDeepLinks {
  /**
   * Fires with the full inbound URL each time the app is opened via a deep link
   * (and once at startup if it was cold-launched from one). The URL keeps its
   * fragment (`#...`), which the share flow relies on to carry the decryption
   * key client-side. Returns an unsubscribe. Web never fires it.
   */
  onOpen(handler: (url: string) => void): () => void;
}

/** The capability surface the UI depends on. */
export interface Platform {
  /** `true` inside the Capacitor native shell, `false` on web. */
  readonly isNative: boolean;
  readonly network: PlatformNetwork;
  readonly lifecycle: PlatformLifecycle;
  readonly backButton: PlatformBackButton;
  readonly deepLinks: PlatformDeepLinks;
}

/**
 * Minimal key/value surface over the device credential store: the Capacitor
 * SecureStorage plugin on the phones (iOS Keychain / Android Keystore), the
 * shell's own commands in the desktop app. The refresh token and the
 * master-key vault are built on it (`@reborn/platform/native`).
 */
export interface NativeSecureStorage {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

/** Inputs the app supplies when assembling the web platform. */
export interface WebPlatformOptions {
  /**
   * The web connectivity store (the app passes `getConnectivity(...)` from
   * `@reborn/api-client`). Injected rather than imported so this package stays
   * dependency-free.
   */
  network: PlatformNetwork;
}
