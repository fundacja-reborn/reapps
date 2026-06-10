import type {
  Platform,
  PlatformBackButton,
  PlatformDeepLinks,
  PlatformLifecycle,
  WebPlatformOptions
} from './types';

/**
 * Web lifecycle via the Page Visibility API. Listeners attach lazily on the
 * first `onResume` / `onPause` so that, on a web build where nothing subscribes
 * (the sync-on-resume wiring is native-only), no `visibilitychange` listener is
 * added at all - the web runtime is left exactly as it was.
 */
function createWebLifecycle(): PlatformLifecycle {
  const resume = new Set<() => void>();
  const pause = new Set<() => void>();
  let attached = false;

  const ensureAttached = () => {
    if (attached || typeof document === 'undefined') return;
    attached = true;
    document.addEventListener('visibilitychange', () => {
      const handlers = document.visibilityState === 'visible' ? resume : pause;
      // Snapshot so a handler that unsubscribes mid-iteration is safe.
      for (const handler of [...handlers]) handler();
    });
  };

  return {
    onResume(handler) {
      ensureAttached();
      resume.add(handler);
      return () => resume.delete(handler);
    },
    onPause(handler) {
      ensureAttached();
      pause.add(handler);
      return () => pause.delete(handler);
    }
  };
}

/** Web back button is a no-op: the browser / PWA history stack handles back. */
function createWebBackButton(): PlatformBackButton {
  return {
    setHandler() {
      /* no-op on web */
    }
  };
}

/**
 * Web deep links are a no-op: a browser navigates to the share URL directly, so
 * there is no inbound link to route into a shell. Returns a no-op unsubscribe.
 */
function createWebDeepLinks(): PlatformDeepLinks {
  return {
    onOpen() {
      return () => {
        /* no-op on web - never fires */
      };
    }
  };
}

/**
 * Assemble the web platform. Network is injected by the app (api-client's
 * `getConnectivity`); lifecycle and back button use the web implementations
 * above. Selected by the app when `__REBORN_NATIVE__` is false.
 */
export function createWebPlatform(options: WebPlatformOptions): Platform {
  return {
    isNative: false,
    network: options.network,
    lifecycle: createWebLifecycle(),
    backButton: createWebBackButton(),
    deepLinks: createWebDeepLinks()
  };
}
