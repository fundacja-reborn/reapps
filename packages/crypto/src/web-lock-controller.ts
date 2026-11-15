/**
 * Web App Lock controller: the idle timer and the cross-tab part of the lock.
 *
 * One instance per browsing context (tab / PWA window), shared by both apps.
 * It watches user activity, decides from recorded timestamps when the idle
 * timeout has run out, follows a lock performed in another tab, and runs the
 * lock sequence: let the app flush unsaved work, drop the key, hand over to
 * the app for the (hard) navigation to the unlock screen.
 *
 * Nothing happens while the lock is off or the tab holds no key - the
 * listeners and the tick are only installed while the lock is enabled.
 *
 * The browser environment is injected so the logic runs under plain Node in
 * tests; apps call `createWebLockController()` with the defaults.
 */

import { cryptoManager } from './cryptoManager';
import {
  WEB_LOCK_ACTIVITY_KEY,
  WEB_LOCK_CONFIG_KEY,
  WEB_LOCK_EPOCH_KEY,
  isWebLockIdleExpired,
  parseStoredTimestamp
} from './web-lock';
import { createLogger } from '@reborn/utils';

const logger = createLogger('WebLock');

/** Why the tab is being locked. */
export type WebLockReason = 'manual' | 'idle' | 'remote';

/** The slice of CryptoManager the controller needs (the singleton by default). */
export interface WebLockKeyHolder {
  isWebLockEnabled(): boolean;
  isWebLockLocked(): boolean;
  isInitialized(): boolean;
  getWebLockTimeoutMs(): number;
  getKeyLoadedAt(): number;
  lockWeb(opts?: { announce?: boolean }): void;
  dropSessionKeyExport(): void;
}

type Listener = (event: unknown) => void;

interface EventSource {
  addEventListener(type: string, listener: Listener, options?: unknown): void;
  removeEventListener(type: string, listener: Listener, options?: unknown): void;
}

/** Browser surface used by the controller. */
export interface WebLockEnv {
  win: EventSource;
  doc: EventSource & { visibilityState?: string };
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now(): number;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WebLockControllerOptions {
  /**
   * Called before the key is dropped, while encryption still works: flush
   * pending saves here. Bounded by {@link BEFORE_LOCK_TIMEOUT_MS}; a rejection
   * or a timeout does not stop the lock.
   *
   * Resolving to `false` means "unsaved work could not be saved". A manual
   * lock is then called off, so the user can deal with it instead of losing
   * the text; an idle or remote lock goes ahead regardless - leaving the app
   * open past its timeout is the worse outcome.
   */
  onBeforeLock?: (reason: WebLockReason) => Promise<unknown> | unknown;
  /**
   * Called right after the key is gone. The app must leave the unlocked UI
   * with a hard navigation to the unlock screen, so the JS context (decrypted
   * stores, editor buffers, undo history) is destroyed with it.
   */
  onLocked: (reason: WebLockReason) => void;
  /** Key holder - defaults to the `cryptoManager` singleton. */
  keyHolder?: WebLockKeyHolder;
  /** Browser environment - defaults to the real `window` / `document`. */
  env?: WebLockEnv;
}

export interface WebLockController {
  /** Install the listeners (idempotent). */
  start(): void;
  /** Remove every listener and timer. */
  stop(): void;
  /** Re-read the settings after the lock was enabled / disabled in this tab. */
  refresh(): void;
  /**
   * Lock now (manual action). Resolves to false only when the lock was called
   * off because unsaved work could not be saved; true otherwise (locked, or
   * nothing to lock).
   */
  lockNow(): Promise<boolean>;
}

/** How long the app may take to flush unsaved work before the key is dropped. */
export const BEFORE_LOCK_TIMEOUT_MS = 2_000;

/** Idle / remote-lock check interval. A comparison of two numbers. */
const TICK_MS = 1_000;

/** Minimum spacing of activity writes to localStorage. */
const ACTIVITY_WRITE_INTERVAL_MS = 5_000;

/**
 * User input that counts as activity. Pointer movement is included so that
 * reading a long note with a hand on the mouse does not lock mid-read.
 * Background sync, timers and notifications never count.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'pointermove'] as const;

const LISTENER_OPTIONS = { capture: true, passive: true };

function browserEnv(): WebLockEnv {
  return {
    win: window,
    doc: document,
    storage: window.localStorage,
    now: () => Date.now(),
    setInterval: (handler, ms) => window.setInterval(handler, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number)
  };
}

export function createWebLockController(options: WebLockControllerOptions): WebLockController {
  const keyHolder = options.keyHolder ?? cryptoManager;
  const env = options.env ?? browserEnv();

  let started = false;
  let armed = false;
  let locking = false;
  let tickHandle: unknown = null;
  /** Last activity seen in THIS tab (epoch ms). */
  let lastLocalActivity = 0;
  /** When this tab last wrote the shared activity timestamp. */
  let lastActivityWrite = 0;

  function readStored(key: string): number {
    try {
      return parseStoredTimestamp(env.storage.getItem(key));
    } catch {
      return 0;
    }
  }

  function noteActivity(): void {
    const now = env.now();
    lastLocalActivity = now;
    if (now - lastActivityWrite < ACTIVITY_WRITE_INTERVAL_MS) return;
    lastActivityWrite = now;
    try {
      env.storage.setItem(WEB_LOCK_ACTIVITY_KEY, String(now));
    } catch {
      // Storage full / blocked: this tab still tracks its own activity.
    }
  }

  /** Returns false only when a manual lock was called off (unsaved work). */
  async function lock(reason: WebLockReason): Promise<boolean> {
    if (locking) return true;
    locking = true;
    try {
      if (options.onBeforeLock) {
        let timer: unknown;
        try {
          const saved = await Promise.race([
            Promise.resolve().then(() => options.onBeforeLock?.(reason)),
            new Promise<void>((resolve) => {
              timer = env.setTimeout(resolve, BEFORE_LOCK_TIMEOUT_MS);
            })
          ]);
          if (saved === false && reason === 'manual') {
            logger.warn('Unsaved work could not be saved - manual lock called off');
            return false;
          }
        } catch (error) {
          logger.warn('Flush before lock failed - locking anyway:', error);
        } finally {
          if (timer !== undefined) env.clearTimeout(timer);
        }
      }
      // From here to the navigation everything is synchronous: no other code
      // can run between the key disappearing and the context going away.
      keyHolder.lockWeb({ announce: reason !== 'remote' });
      options.onLocked(reason);
      return true;
    } finally {
      locking = false;
    }
  }

  /** Decide whether this tab must lock right now. */
  function check(): void {
    if (locking) return;
    if (!keyHolder.isWebLockEnabled() || !keyHolder.isInitialized()) return;

    const keyLoadedAt = keyHolder.getKeyLoadedAt();
    // Another tab locked after this tab got its key: follow.
    if (readStored(WEB_LOCK_EPOCH_KEY) > keyLoadedAt) {
      void lock('remote');
      return;
    }

    const lastActivity = Math.max(lastLocalActivity, readStored(WEB_LOCK_ACTIVITY_KEY), keyLoadedAt);
    if (isWebLockIdleExpired(env.now(), lastActivity, keyHolder.getWebLockTimeoutMs())) {
      void lock('idle');
    }
  }

  const onActivity: Listener = () => noteActivity();

  const onReturn: Listener = () => {
    if (env.doc.visibilityState !== undefined && env.doc.visibilityState !== 'visible') return;
    check();
  };

  const onPageShow: Listener = (event) => {
    // Restored from the back/forward cache while locked: the page content is
    // from before the lock. Hand over so the app reloads into the unlock screen.
    if ((event as { persisted?: boolean } | null)?.persisted && keyHolder.isWebLockLocked()) {
      options.onLocked('remote');
      return;
    }
    check();
  };

  const onStorage: Listener = (event) => {
    const key = (event as { key?: string | null } | null)?.key;
    if (key === WEB_LOCK_EPOCH_KEY) {
      check();
    } else if (key === WEB_LOCK_CONFIG_KEY) {
      // The lock was switched in another tab. When it was turned on, this
      // tab's own raw key export must go too (sessionStorage is per tab).
      if (keyHolder.isWebLockEnabled()) keyHolder.dropSessionKeyExport();
      refresh();
    }
  };

  /** Install or remove the activity listeners and the tick to match the setting. */
  function refresh(): void {
    if (!started) return;
    const enabled = keyHolder.isWebLockEnabled();
    if (enabled && !armed) {
      armed = true;
      for (const type of ACTIVITY_EVENTS) {
        env.doc.addEventListener(type, onActivity, LISTENER_OPTIONS);
      }
      env.doc.addEventListener('visibilitychange', onReturn);
      env.win.addEventListener('focus', onReturn);
      tickHandle = env.setInterval(check, TICK_MS);
      check();
    } else if (!enabled && armed) {
      disarm();
    }
  }

  function disarm(): void {
    if (!armed) return;
    armed = false;
    for (const type of ACTIVITY_EVENTS) {
      env.doc.removeEventListener(type, onActivity, LISTENER_OPTIONS);
    }
    env.doc.removeEventListener('visibilitychange', onReturn);
    env.win.removeEventListener('focus', onReturn);
    if (tickHandle !== null) env.clearInterval(tickHandle);
    tickHandle = null;
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      env.win.addEventListener('storage', onStorage);
      env.win.addEventListener('pageshow', onPageShow);
      refresh();
    },
    stop(): void {
      if (!started) return;
      started = false;
      env.win.removeEventListener('storage', onStorage);
      env.win.removeEventListener('pageshow', onPageShow);
      disarm();
    },
    refresh,
    lockNow(): Promise<boolean> {
      if (!keyHolder.isWebLockEnabled() || !keyHolder.isInitialized()) {
        return Promise.resolve(true);
      }
      return lock('manual');
    }
  };
}
