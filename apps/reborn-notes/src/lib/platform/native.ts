/**
 * Native (Capacitor) platform implementation for the reborn-notes shell.
 *
 * Implements the `@reborn/platform` interfaces with Capacitor plugins. Each
 * plugin is loaded with a dynamic `import()` so that, on the web build, this
 * module's exports go unused and the whole thing - plugins included - is
 * dead-code-eliminated: the selector in `./index.ts` resolves to the web
 * platform when `__REBORN_NATIVE__` is false, leaving these functions
 * unreferenced. Same pattern as `$lib/utils/native-auth-storage.ts`.
 *
 * Native impls deliberately live here (app-local) rather than in
 * `@reborn/platform`, to keep Capacitor out of the shared package until a second
 * app needs these plugins (then they get promoted). See
 * `docs/development/planning/native-faza3-plan.md`.
 */
import type {
  NetworkState,
  Platform,
  PlatformBackButton,
  PlatformLifecycle,
  PlatformNetwork
} from '@reborn/platform';

/**
 * Device connectivity via `@capacitor/network`, replacing the web HTTP probe
 * (which is meaningless in the shell - local assets answer same-origin
 * regardless of upstream).
 */
class NativeNetwork implements PlatformNetwork {
  private state: NetworkState = { status: 'unknown', lastProbeAt: null };
  private listeners = new Set<(state: NetworkState) => void>();
  private removeListener: (() => void) | null = null;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const { Network } = await import('@capacitor/network');
      const status = await Network.getStatus();
      this.set(status.connected);
      const handle = await Network.addListener('networkStatusChange', (s) =>
        this.set(s.connected)
      );
      this.removeListener = () => void handle.remove();
    } catch {
      // Plugin load failed: stay 'unknown', which isOnline treats as online
      // (optimistic) - the same seed the web probe uses before its first round-trip.
    }
  }

  private set(connected: boolean): void {
    const status: NetworkState['status'] = connected ? 'online' : 'offline';
    const changed = status !== this.state.status;
    this.state = { status, lastProbeAt: Date.now() };
    if (changed) for (const listener of [...this.listeners]) listener(this.state);
  }

  subscribe(listener: (state: NetworkState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): NetworkState {
    return this.state;
  }

  async refresh(): Promise<boolean> {
    try {
      const { Network } = await import('@capacitor/network');
      const status = await Network.getStatus();
      this.set(status.connected);
      return status.connected;
    } catch {
      return this.state.status !== 'offline';
    }
  }

  markFailure(): void {
    // Connectivity comes from the OS, not from request outcomes - nothing to do.
  }

  destroy(): void {
    this.removeListener?.();
    this.removeListener = null;
    this.listeners.clear();
  }
}

/** App foreground/background via `@capacitor/app` `appStateChange`. */
function createNativeLifecycle(): PlatformLifecycle {
  const resume = new Set<() => void>();
  const pause = new Set<() => void>();
  let wired = false;

  const ensureWired = async () => {
    if (wired) return;
    wired = true;
    try {
      const { App } = await import('@capacitor/app');
      await App.addListener('appStateChange', ({ isActive }) => {
        const handlers = isActive ? resume : pause;
        for (const handler of [...handlers]) handler();
      });
    } catch {
      wired = false; // let a later subscriber retry if the plugin failed to load
    }
  };

  return {
    onResume(handler) {
      void ensureWired();
      resume.add(handler);
      return () => resume.delete(handler);
    },
    onPause(handler) {
      void ensureWired();
      pause.add(handler);
      return () => pause.delete(handler);
    }
  };
}

/** Android hardware back via `@capacitor/app` `backButton`. */
function createNativeBackButton(): PlatformBackButton {
  let handler: (() => boolean) | null = null;
  let wired = false;

  const ensureWired = async () => {
    if (wired) return;
    wired = true;
    try {
      const { App } = await import('@capacitor/app');
      await App.addListener('backButton', ({ canGoBack }) => {
        if (handler && handler()) return; // consumed by the app
        // At the mobile-history "guard" root (see the +page.svelte trampoline)
        // or with no webview history, exit. Otherwise walk back, which drives
        // the existing popstate up-navigation.
        const atRoot =
          typeof window !== 'undefined' &&
          (window.history.state as { _rn?: string } | null)?._rn === 'guard';
        if (atRoot || !canGoBack) {
          void App.exitApp();
        } else {
          window.history.back();
        }
      });
    } catch {
      wired = false;
    }
  };

  void ensureWired();

  return {
    setHandler(next) {
      handler = next;
      void ensureWired();
    }
  };
}

/** Assemble the native platform. Network is device-based, so no options needed. */
export function createNativePlatform(): Platform {
  return {
    isNative: true,
    network: new NativeNetwork(),
    lifecycle: createNativeLifecycle(),
    backButton: createNativeBackButton()
  };
}
