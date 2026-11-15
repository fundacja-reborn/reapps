import { describe, it, expect, vi } from 'vitest';
import {
  BEFORE_LOCK_TIMEOUT_MS,
  createWebLockController,
  type WebLockEnv,
  type WebLockKeyHolder,
  type WebLockReason
} from '../web-lock-controller';

/**
 * The controller is exercised against a hand-rolled browser: two event buses
 * (window, document), a storage map shared between "tabs", a manual clock and
 * manually driven timers. No real time passes.
 */

const ACTIVITY_KEY = 'reborn_web_lock_activity';
const EPOCH_KEY = 'reborn_web_lock_epoch';
const CONFIG_KEY = 'reborn_web_lock';
const MINUTE = 60_000;
const START = 1_700_000_000_000;

type Listener = (event: unknown) => void;

function makeBus() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string, event: unknown = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    }
  };
}

function makeTab(shared: Map<string, string>, opts: { timeoutMs?: number } = {}) {
  const win = makeBus();
  const doc = Object.assign(makeBus(), { visibilityState: 'visible' });
  let now = START;
  const intervals = new Set<() => void>();
  const timeouts = new Map<number, { handler: () => void; at: number }>();
  let nextId = 1;

  const env: WebLockEnv = {
    win,
    doc,
    storage: {
      getItem: (key) => shared.get(key) ?? null,
      setItem: (key, value) => {
        shared.set(key, String(value));
      }
    },
    now: () => now,
    setInterval: (handler) => {
      intervals.add(handler);
      return handler;
    },
    clearInterval: (handle) => {
      intervals.delete(handle as () => void);
    },
    setTimeout: (handler, ms) => {
      const id = nextId++;
      timeouts.set(id, { handler, at: now + ms });
      return id;
    },
    clearTimeout: (handle) => {
      timeouts.delete(handle as number);
    }
  };

  const state = {
    enabled: true,
    hasKey: true,
    keyLoadedAt: START,
    timeoutMs: opts.timeoutMs ?? 5 * MINUTE,
    sessionExportDropped: 0,
    /** What a key request to the other tabs resolves to. */
    peerHasKey: false,
    keyRequests: 0,
    offers: [] as string[]
  };
  let handoffHandler: ((signal: { t: 'request'; id: string } | { t: 'available' }) => void) | null =
    null;
  const keyHolder: WebLockKeyHolder = {
    isWebLockEnabled: () => state.enabled,
    isWebLockLocked: () => state.enabled && !state.hasKey,
    isInitialized: () => state.hasKey,
    getWebLockTimeoutMs: () => state.timeoutMs,
    getKeyLoadedAt: () => (state.hasKey ? state.keyLoadedAt : 0),
    lockWeb: (lockOpts) => {
      state.hasKey = false;
      if (lockOpts?.announce !== false) shared.set(EPOCH_KEY, String(now));
    },
    dropSessionKeyExport: () => {
      state.sessionExportDropped++;
    },
    requestKeyFromPeer: async () => {
      state.keyRequests++;
      if (!state.peerHasKey) return false;
      state.hasKey = true;
      state.keyLoadedAt = now;
      return true;
    },
    offerKeyToPeer: (id) => {
      state.offers.push(id);
    },
    subscribeToHandoff: (handler) => {
      handoffHandler = handler;
      return () => {
        handoffHandler = null;
      };
    }
  };

  const locked: WebLockReason[] = [];
  const beforeLock = vi.fn<(reason: WebLockReason) => Promise<void> | void>();
  const unlockedByPeer = vi.fn();
  const controller = createWebLockController({
    env,
    keyHolder,
    onBeforeLock: beforeLock,
    onLocked: (reason) => {
      locked.push(reason);
    },
    onUnlockedByPeer: unlockedByPeer
  });

  return {
    controller,
    state,
    win,
    doc,
    locked,
    beforeLock,
    unlockedByPeer,
    /** Deliver a handoff signal from another tab. */
    handoff(signal: { t: 'request'; id: string } | { t: 'available' }) {
      handoffHandler?.(signal);
    },
    subscribed: () => handoffHandler !== null,
    /** Move the clock and run the interval ticks + due timeouts once. */
    async advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timeouts]) {
        if (timer.at <= now) {
          timeouts.delete(id);
          timer.handler();
        }
      }
      for (const tick of [...intervals]) tick();
      await flush();
    },
    activity(type = 'pointerdown') {
      doc.emit(type);
    },
    ticking: () => intervals.size
  };
}

/** Let pending promise continuations run. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('web-lock controller', () => {
  it('does nothing while the lock is off', async () => {
    const tab = makeTab(new Map());
    tab.state.enabled = false;
    tab.controller.start();

    expect(tab.ticking()).toBe(0);
    expect(tab.doc.count('pointerdown')).toBe(0);
    await tab.advance(24 * 60 * MINUTE);
    expect(tab.locked).toEqual([]);
  });

  it('locks after the idle timeout, flushing unsaved work first', async () => {
    const tab = makeTab(new Map());
    const order: string[] = [];
    tab.beforeLock.mockImplementation(() => {
      order.push(`flush:${tab.state.hasKey ? 'key' : 'no-key'}`);
    });
    tab.controller.start();

    await tab.advance(5 * MINUTE - 1_000);
    expect(tab.locked).toEqual([]);

    await tab.advance(1_000);
    expect(tab.locked).toEqual(['idle']);
    expect(tab.state.hasKey).toBe(false);
    // The flush ran while the key was still there.
    expect(order).toEqual(['flush:key']);
  });

  it('counts activity in this tab, including pointer movement', async () => {
    const tab = makeTab(new Map());
    tab.controller.start();

    await tab.advance(4 * MINUTE);
    tab.activity('pointermove');
    await tab.advance(4 * MINUTE);
    expect(tab.locked).toEqual([]);

    await tab.advance(MINUTE);
    expect(tab.locked).toEqual(['idle']);
  });

  it('counts activity in another tab of the origin', async () => {
    const shared = new Map<string, string>();
    const a = makeTab(shared);
    const b = makeTab(shared);
    a.controller.start();
    b.controller.start();

    await a.advance(4 * MINUTE);
    await b.advance(4 * MINUTE);
    b.activity('keydown');
    expect(Number(shared.get(ACTIVITY_KEY))).toBe(START + 4 * MINUTE);

    // Tab A saw no input itself, but B's activity keeps it open.
    await a.advance(4 * MINUTE);
    expect(a.locked).toEqual([]);
  });

  it('writes the shared activity timestamp at most every 5 s', async () => {
    const shared = new Map<string, string>();
    const tab = makeTab(shared);
    tab.controller.start();

    await tab.advance(10_000);
    tab.activity();
    const first = shared.get(ACTIVITY_KEY);
    await tab.advance(2_000);
    tab.activity();
    expect(shared.get(ACTIVITY_KEY)).toBe(first);
    await tab.advance(4_000);
    tab.activity();
    expect(shared.get(ACTIVITY_KEY)).not.toBe(first);
  });

  it('never locks on idle with the "never" preset, but still locks manually', async () => {
    const tab = makeTab(new Map(), { timeoutMs: 0 });
    tab.controller.start();

    await tab.advance(48 * 60 * MINUTE);
    expect(tab.locked).toEqual([]);

    expect(await tab.controller.lockNow()).toBe(true);
    expect(tab.locked).toEqual(['manual']);
  });

  it('a lock in one tab locks the others, without re-announcing', async () => {
    const shared = new Map<string, string>();
    const a = makeTab(shared);
    const b = makeTab(shared);
    a.controller.start();
    b.controller.start();

    await a.advance(MINUTE);
    await a.controller.lockNow();
    const epoch = shared.get(EPOCH_KEY);
    expect(epoch).toBe(String(START + MINUTE));

    b.win.emit('storage', { key: EPOCH_KEY });
    await flush();
    expect(b.locked).toEqual(['remote']);
    expect(b.state.hasKey).toBe(false);
    expect(shared.get(EPOCH_KEY)).toBe(epoch);
  });

  it('a tab that missed the storage event locks when the user returns to it', async () => {
    const shared = new Map<string, string>();
    const frozen = makeTab(shared);
    frozen.controller.start();
    frozen.doc.visibilityState = 'hidden';
    shared.set(EPOCH_KEY, String(START + 10_000));

    frozen.doc.visibilityState = 'visible';
    frozen.doc.emit('visibilitychange');
    await flush();
    expect(frozen.locked).toEqual(['remote']);
  });

  it('ignores a lock older than this tab\'s key (unlocked after the lock)', async () => {
    const shared = new Map<string, string>();
    shared.set(EPOCH_KEY, String(START - 10_000));
    const tab = makeTab(shared);
    tab.controller.start();

    await tab.advance(1_000);
    expect(tab.locked).toEqual([]);
  });

  it('stays out of the way while the tab holds no key', async () => {
    const tab = makeTab(new Map());
    tab.state.hasKey = false;
    tab.controller.start();

    await tab.advance(60 * MINUTE);
    await tab.controller.lockNow();
    expect(tab.locked).toEqual([]);
    expect(tab.beforeLock).not.toHaveBeenCalled();
  });

  it('locks anyway when the flush hangs or throws', async () => {
    const hanging = makeTab(new Map());
    hanging.beforeLock.mockImplementation(
      () =>
        new Promise<void>(() => {
          /* never settles */
        })
    );
    hanging.controller.start();
    const pending = hanging.controller.lockNow();
    await flush();
    expect(hanging.locked).toEqual([]);
    await hanging.advance(BEFORE_LOCK_TIMEOUT_MS);
    await pending;
    expect(hanging.locked).toEqual(['manual']);

    const throwing = makeTab(new Map());
    throwing.beforeLock.mockImplementation(() => {
      throw new Error('save failed');
    });
    throwing.controller.start();
    await throwing.controller.lockNow();
    expect(throwing.locked).toEqual(['manual']);
    expect(throwing.state.hasKey).toBe(false);
  });

  it('calls a manual lock off when unsaved work could not be saved, but not an idle one', async () => {
    const manual = makeTab(new Map());
    manual.beforeLock.mockImplementation(async () => false as unknown as void);
    manual.controller.start();

    expect(await manual.controller.lockNow()).toBe(false);
    expect(manual.locked).toEqual([]);
    expect(manual.state.hasKey).toBe(true);

    const idle = makeTab(new Map());
    idle.beforeLock.mockImplementation(async () => false as unknown as void);
    idle.controller.start();
    await idle.advance(5 * 60_000);
    expect(idle.locked).toEqual(['idle']);
    expect(idle.state.hasKey).toBe(false);
  });

  it('runs one lock sequence even when triggers pile up', async () => {
    const tab = makeTab(new Map());
    let release: () => void = () => undefined;
    tab.beforeLock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    tab.controller.start();

    const first = tab.controller.lockNow();
    const second = tab.controller.lockNow();
    await flush();
    release();
    await Promise.all([first, second]);

    expect(tab.beforeLock).toHaveBeenCalledTimes(1);
    expect(tab.locked).toEqual(['manual']);
  });

  it('hands over when a locked page comes back from the back/forward cache', () => {
    const tab = makeTab(new Map());
    tab.controller.start();
    tab.state.hasKey = false;

    tab.win.emit('pageshow', { persisted: true });
    expect(tab.locked).toEqual(['remote']);
  });

  it('arms and disarms when the setting changes (this tab and another one)', async () => {
    const tab = makeTab(new Map());
    tab.state.enabled = false;
    tab.controller.start();
    expect(tab.ticking()).toBe(0);

    // Enabled in another tab: this tab drops its own raw key export and arms.
    tab.state.enabled = true;
    tab.win.emit('storage', { key: CONFIG_KEY });
    expect(tab.state.sessionExportDropped).toBe(1);
    expect(tab.ticking()).toBe(1);

    // Disabled in this tab.
    tab.state.enabled = false;
    tab.controller.refresh();
    expect(tab.ticking()).toBe(0);
    expect(tab.doc.count('pointerdown')).toBe(0);
  });

  it('a tab that missed the "lock turned on" event arms when the user returns to it', async () => {
    const tab = makeTab(new Map());
    tab.state.enabled = false;
    tab.controller.start();

    // Turned on in another tab while this one was frozen: no storage event.
    tab.state.enabled = true;
    expect(tab.ticking()).toBe(0);

    tab.doc.emit('visibilitychange');
    expect(tab.ticking()).toBe(1);
    expect(tab.state.sessionExportDropped).toBe(1);

    await tab.advance(5 * MINUTE);
    expect(tab.locked).toEqual(['idle']);
  });

  describe('key handoff between tabs', () => {
    it('an unlocked tab answers a key request', () => {
      const tab = makeTab(new Map());
      tab.controller.start();

      tab.handoff({ t: 'request', id: 'r1' });
      expect(tab.state.offers).toEqual(['r1']);
    });

    it('a locked tab, or one with the lock off, does not answer', () => {
      const locked = makeTab(new Map());
      locked.state.hasKey = false;
      locked.controller.start();
      locked.handoff({ t: 'request', id: 'r1' });
      expect(locked.state.offers).toEqual([]);

      const off = makeTab(new Map());
      off.state.enabled = false;
      off.controller.start();
      off.handoff({ t: 'request', id: 'r2' });
      expect(off.state.offers).toEqual([]);
    });

    it('a tab that is itself due to lock locks instead of handing its key over', async () => {
      // Woken from a freeze: it still holds a key, but the app was locked
      // elsewhere in the meantime.
      const shared = new Map<string, string>([[EPOCH_KEY, String(START + 10_000)]]);
      const stale = makeTab(shared);
      stale.controller.start();
      await flush();
      stale.locked.length = 0;
      stale.state.hasKey = true; // as if the first check had not run yet

      stale.handoff({ t: 'request', id: 'r1' });
      await flush();
      expect(stale.state.offers).toEqual([]);
      expect(stale.locked).toEqual(['remote']);

      // Same for a tab that sat idle past the timeout.
      const idle = makeTab(new Map());
      idle.controller.start();
      await idle.advance(0);
      idle.state.keyLoadedAt = START - 10 * MINUTE;
      idle.handoff({ t: 'request', id: 'r2' });
      await flush();
      expect(idle.state.offers).toEqual([]);
      expect(idle.locked).toEqual(['idle']);
    });

    it('a locked tab takes the key when another tab unlocks with the password', async () => {
      const tab = makeTab(new Map());
      tab.state.hasKey = false;
      tab.state.peerHasKey = true;
      tab.controller.start();

      tab.handoff({ t: 'available' });
      await flush();

      expect(tab.state.hasKey).toBe(true);
      expect(tab.unlockedByPeer).toHaveBeenCalledTimes(1);
      expect(tab.locked).toEqual([]);
    });

    it('a locked tab asks again when the user returns to it', async () => {
      const tab = makeTab(new Map());
      tab.state.hasKey = false;
      tab.controller.start();

      // Nobody is unlocked: the request comes back empty, the tab stays locked.
      tab.doc.emit('visibilitychange');
      await flush();
      expect(tab.state.keyRequests).toBe(1);
      expect(tab.unlockedByPeer).not.toHaveBeenCalled();

      tab.state.peerHasKey = true;
      tab.win.emit('focus');
      await flush();
      expect(tab.unlockedByPeer).toHaveBeenCalledTimes(1);
    });

    it('an unlocked tab never asks for a key', async () => {
      const tab = makeTab(new Map());
      tab.controller.start();
      tab.handoff({ t: 'available' });
      tab.doc.emit('visibilitychange');
      await flush();
      expect(tab.state.keyRequests).toBe(0);
    });
  });

  it('stop() removes every listener and timer', () => {
    const tab = makeTab(new Map());
    tab.controller.start();
    tab.controller.stop();

    expect(tab.ticking()).toBe(0);
    expect(tab.win.count('storage')).toBe(0);
    expect(tab.win.count('pageshow')).toBe(0);
    expect(tab.win.count('focus')).toBe(0);
    expect(tab.doc.count('keydown')).toBe(0);
    expect(tab.doc.count('visibilitychange')).toBe(0);
    expect(tab.subscribed()).toBe(false);
  });
});
