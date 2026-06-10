import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createWebPlatform } from './web';
import type { NetworkState, PlatformNetwork } from './types';

const noop = () => {
  /* intentionally empty */
};

function fakeNetwork(): PlatformNetwork {
  const state: NetworkState = { status: 'online', lastProbeAt: null };
  return {
    subscribe: (l) => {
      l(state);
      return noop;
    },
    getState: () => state,
    refresh: async () => true,
    markFailure: noop,
    destroy: noop
  };
}

// Minimal `document` stub so the web lifecycle can attach a visibilitychange
// listener under the node test environment (no jsdom dependency needed).
type Handler = () => void;
function installDocumentStub() {
  const listeners: Record<string, Handler[]> = {};
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (type: string, cb: Handler) => {
      (listeners[type] ??= []).push(cb);
    },
    removeEventListener: noop
  };
  (globalThis as { document?: unknown }).document = doc;
  return {
    fire(type: string) {
      for (const cb of listeners[type] ?? []) cb();
    },
    setVisibility(v: DocumentVisibilityState) {
      doc.visibilityState = v;
    }
  };
}

describe('createWebPlatform', () => {
  let dom: ReturnType<typeof installDocumentStub>;

  beforeEach(() => {
    dom = installDocumentStub();
  });

  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('is not native and passes through the injected network store', () => {
    const network = fakeNetwork();
    const platform = createWebPlatform({ network });
    expect(platform.isNative).toBe(false);
    expect(platform.network).toBe(network);
  });

  it('fires onResume when the page becomes visible and onPause when hidden', () => {
    const platform = createWebPlatform({ network: fakeNetwork() });
    const onResume = vi.fn();
    const onPause = vi.fn();
    platform.lifecycle.onResume(onResume);
    platform.lifecycle.onPause(onPause);

    dom.setVisibility('hidden');
    dom.fire('visibilitychange');
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();

    dom.setVisibility('visible');
    dom.fire('visibilitychange');
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('stops calling a handler after its unsubscribe', () => {
    const platform = createWebPlatform({ network: fakeNetwork() });
    const onPause = vi.fn();
    const off = platform.lifecycle.onPause(onPause);

    dom.setVisibility('hidden');
    dom.fire('visibilitychange');
    expect(onPause).toHaveBeenCalledTimes(1);

    off();
    dom.fire('visibilitychange');
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('web back button is a no-op (does not throw)', () => {
    const platform = createWebPlatform({ network: fakeNetwork() });
    expect(() => platform.backButton.setHandler(() => true)).not.toThrow();
    expect(() => platform.backButton.setHandler(null)).not.toThrow();
  });
});
