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
 * - This package is intentionally dependency-free. The web connectivity store
 *   already lives in `@reborn/api-client` (`getConnectivity`), so the app
 *   injects it via `createWebPlatform({ network })` instead of the package
 *   hard-wiring a dependency - keeping the boundary clean and the build trivial.
 * - Native implementations (Capacitor plugins) live app-local for now; they are
 *   promoted into this package once a second app consumes them, to avoid pulling
 *   Capacitor deps into a shared package before there is a second consumer.
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

/** The capability surface the UI depends on. */
export interface Platform {
  /** `true` inside the Capacitor native shell, `false` on web. */
  readonly isNative: boolean;
  readonly network: PlatformNetwork;
  readonly lifecycle: PlatformLifecycle;
  readonly backButton: PlatformBackButton;
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
