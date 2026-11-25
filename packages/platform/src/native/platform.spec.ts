import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (payload: unknown) => void | Promise<void>;
const appListeners = new Map<string, Listener>();
let networkListener: Listener | null = null;
let launchUrl: string | null = null;
const exitApp = vi.fn();

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event: string, listener: Listener) => {
      appListeners.set(event, listener);
      return { remove: async () => appListeners.delete(event) };
    },
    getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : undefined),
    exitApp: () => exitApp()
  }
}));

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: async () => ({ connected: true }),
    addListener: async (_event: string, listener: Listener) => {
      networkListener = listener;
      return { remove: async () => (networkListener = null) };
    }
  }
}));

import { createCapacitorPlatform } from './platform';

/** Wait until the lazily wired plugin listener for `event` is registered. */
const wired = (event: string) => vi.waitFor(() => expect(appListeners.has(event)).toBe(true));

/**
 * A platform whose back button (wired at construction) is already listening.
 * Vitest can hand a CONCURRENT dynamic import of a mocked module the real
 * package, so each test lets one wiring finish before starting the next.
 */
async function createPlatform() {
  const platform = createCapacitorPlatform();
  await wired('backButton');
  return platform;
}

describe('createCapacitorPlatform', () => {
  beforeEach(() => {
    appListeners.clear();
    networkListener = null;
    launchUrl = null;
  });

  it('reports device connectivity and its changes', async () => {
    const platform = createCapacitorPlatform();
    const seen: string[] = [];
    platform.network.subscribe((state) => seen.push(state.status));
    await vi.waitFor(() => expect(networkListener).not.toBeNull());
    networkListener?.({ connected: false });
    expect(seen).toEqual(['unknown', 'online', 'offline']);
    expect(platform.network.getState().status).toBe('offline');
    platform.network.destroy();
  });

  it('maps appStateChange to resume and pause', async () => {
    const platform = await createPlatform();
    const events: string[] = [];
    platform.lifecycle.onResume(() => events.push('resume'));
    const offPause = platform.lifecycle.onPause(() => events.push('pause'));
    await wired('appStateChange');
    appListeners.get('appStateChange')?.({ isActive: false });
    appListeners.get('appStateChange')?.({ isActive: true });
    offPause();
    appListeners.get('appStateChange')?.({ isActive: false });
    expect(events).toEqual(['pause', 'resume']);
  });

  describe('back button', () => {
    const historyBack = vi.fn();
    /** Open overlay layers the stubbed document reports, before and after BACK. */
    let openLayers: number[] = [];

    beforeEach(() => {
      exitApp.mockClear();
      historyBack.mockClear();
      openLayers = [];
      vi.stubGlobal('window', { history: { state: null, back: historyBack } });
      vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));
      vi.stubGlobal('KeyboardEvent', class {
        constructor(readonly type: string) {}
      });
      vi.stubGlobal('HTMLElement', class {});
      vi.stubGlobal('document', {
        activeElement: null,
        body: { dispatchEvent: () => true },
        querySelectorAll: () => ({ length: openLayers.shift() ?? 0 })
      });
      return () => vi.unstubAllGlobals();
    });

    const press = (canGoBack: boolean) => appListeners.get('backButton')?.({ canGoBack });

    it('closes an open overlay without asking the app or navigating', async () => {
      const platform = await createPlatform();
      const handler = vi.fn(() => 'exit' as const);
      platform.backButton.setHandler(handler);
      openLayers = [1, 0];
      await press(true);
      expect(handler).not.toHaveBeenCalled();
      expect(exitApp).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('does nothing more when the app handled the press', async () => {
      const platform = await createPlatform();
      platform.backButton.setHandler(() => 'handled');
      await press(true);
      expect(exitApp).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('exits on request even with webview history left', async () => {
      const platform = await createPlatform();
      platform.backButton.setHandler(() => 'exit');
      await press(true);
      expect(exitApp).toHaveBeenCalledOnce();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('walks the history by default and exits when none is left', async () => {
      const platform = await createPlatform();
      platform.backButton.setHandler(() => 'default');
      await press(true);
      expect(historyBack).toHaveBeenCalledOnce();
      platform.backButton.setHandler(null);
      await press(false);
      expect(exitApp).toHaveBeenCalledOnce();
    });
  });

  it('delivers the cold-start launch URL once, then warm opens', async () => {
    launchUrl = 'https://reapps.eu/task/s/abc#k=1';
    const platform = await createPlatform();
    const urls: string[] = [];
    platform.deepLinks.onOpen((url) => urls.push(url));
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    // The same launch URL reported again right away is the cold-start echo.
    appListeners.get('appUrlOpen')?.({ url: launchUrl });
    appListeners.get('appUrlOpen')?.({ url: 'https://reapps.eu/task/s/def#k=2' });
    expect(urls).toEqual(['https://reapps.eu/task/s/abc#k=1', 'https://reapps.eu/task/s/def#k=2']);
  });
});
