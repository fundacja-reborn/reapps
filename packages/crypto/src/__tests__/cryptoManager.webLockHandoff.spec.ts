import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CryptoManager } from '../cryptoManager';

/**
 * Web App Lock key handoff: with the lock on, each tab holds the key in its
 * own memory. An unlocked tab hands it to a locked / new / reloaded tab of the
 * same origin over a BroadcastChannel, so only the first tab needs the
 * password. Nothing may reach storage on the way.
 *
 * Each `new CryptoManager()` is a tab. The fake channel below connects every
 * instance created with the same name, like BroadcastChannel does within one
 * origin, and never delivers a message back to its sender.
 */
const CONFIG_KEY = 'reborn_web_lock';
const EPOCH_KEY = 'reborn_web_lock_epoch';
const ACCOUNT_KEY = 'reborn_auth_credentials';
const TEMP_KEY = 'TEMP_MASTER_KEY_EXPORT';
const CHANNEL = 'reborn_web_lock_handoff';
const PASSWORD = 'correct horse battery';

type Win = { localStorage: Storage; sessionStorage: Storage; BroadcastChannel?: unknown };
const win = () => (global as unknown as { window: Win }).window;
const ls = () => win().localStorage;
const ss = () => win().sessionStorage;
const freshManager = () => new (CryptoManager as unknown as { new (): CryptoManager })();

/** Everything posted on the handoff channel, for assertions. */
let posted: Array<{ t?: string }> = [];

class FakeBroadcastChannel {
  private static channels = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(private readonly name: string) {
    if (!FakeBroadcastChannel.channels.has(name)) {
      FakeBroadcastChannel.channels.set(name, new Set());
    }
    FakeBroadcastChannel.channels.get(name)?.add(this);
  }

  postMessage(message: unknown): void {
    if (this.name === CHANNEL) posted.push(message as { t?: string });
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer === this) continue;
      // Asynchronous, like the real thing.
      queueMicrotask(() => peer.onmessage?.({ data: message }));
    }
  }

  static reset(): void {
    FakeBroadcastChannel.channels.clear();
  }
}

/** A tab that unlocked with the password and answers key requests. */
async function unlockedTab() {
  const tab = freshManager();
  const key = await tab.generateMasterKey();
  await tab.setMasterKey(key);
  const wrap = await tab.encryptMasterKey(key, PASSWORD);
  ls().setItem(ACCOUNT_KEY, JSON.stringify({ id: 'u1' }));
  await tab.enableWebLock({ password: PASSWORD, ...wrap });
  // The lock controller decides when to answer; here the tab always does.
  tab.subscribeToHandoff((signal) => {
    if (signal.t === 'request') tab.offerKeyToPeer(signal.id);
  });
  return { tab, wrap };
}

describe('CryptoManager - Web App Lock key handoff', () => {
  beforeEach(() => {
    ls().clear();
    ss().clear();
    posted = [];
    FakeBroadcastChannel.reset();
    win().BroadcastChannel = FakeBroadcastChannel;
  });

  afterEach(() => {
    delete win().BroadcastChannel;
  });

  it('a new tab gets the key from an unlocked tab instead of asking for the password', async () => {
    const { tab: first } = await unlockedTab();
    const ciphertext = await first.encryptString('written in the first tab');

    const second = freshManager();
    expect(await second.waitForRestore()).toBe(true);

    expect(second.isInitialized()).toBe(true);
    expect(second.isWebLockLocked()).toBe(false);
    expect(await second.decryptString(ciphertext)).toBe('written in the first tab');
    expect(second.getKeyLoadedAt()).toBeGreaterThan(0);
  });

  it('keeps the key out of storage on both sides', async () => {
    await unlockedTab();
    const second = freshManager();
    await second.waitForRestore();

    expect(ss().getItem(TEMP_KEY)).toBeNull();
    const stored = JSON.stringify({
      config: ls().getItem(CONFIG_KEY),
      epoch: ls().getItem(EPOCH_KEY)
    });
    expect(stored).not.toContain('CryptoKey');
    // The next cold start with no unlocked tab around is locked again.
    FakeBroadcastChannel.reset();
    expect(await freshManager().waitForRestore()).toBe(false);
  });

  it('stays locked when no other tab is unlocked', async () => {
    const { tab: first } = await unlockedTab();
    first.lockWeb();

    const second = freshManager();
    expect(await second.waitForRestore()).toBe(false);
    expect(second.isWebLockLocked()).toBe(true);
  });

  it('a locked tab can ask later, once another tab has unlocked', async () => {
    const { tab: first, wrap } = await unlockedTab();
    first.lockWeb();
    const second = freshManager();
    await second.waitForRestore();
    expect(second.isWebLockLocked()).toBe(true);

    await first.loadUserMasterKey(wrap.encryptedMasterKey, wrap.salt, PASSWORD);
    // The password unlock announces the key to locked tabs.
    expect(posted.some((message) => message.t === 'available')).toBe(true);

    expect(await second.requestKeyFromPeer()).toBe(true);
    expect(second.isInitialized()).toBe(true);
  });

  it('ignores an offer older than the last lock', async () => {
    const { tab: first } = await unlockedTab();
    const second = freshManager();
    // Locked a moment after the offer will have been sent.
    ls().setItem(EPOCH_KEY, String(Date.now() + 60_000));

    expect(await second.waitForRestore()).toBe(false);
    expect(second.isInitialized()).toBe(false);
    expect(first.isInitialized()).toBe(true);
  });

  it('rejects an offer that does not carry a usable key', async () => {
    ls().setItem(ACCOUNT_KEY, JSON.stringify({ id: 'u1' }));
    ls().setItem(CONFIG_KEY, JSON.stringify({ v: 1, timeoutMs: 300_000 }));
    const rogue = new FakeBroadcastChannel(CHANNEL);
    rogue.onmessage = (event) => {
      const data = event.data as { t?: string; id?: string };
      if (data.t === 'request') {
        rogue.postMessage({ t: 'offer', id: data.id, key: 'not a key', sentAt: Date.now() });
      }
    };

    const tab = freshManager();
    expect(await tab.waitForRestore()).toBe(false);
    expect(tab.isInitialized()).toBe(false);
  });

  it('ignores an offer for a request it did not make', async () => {
    const { tab: first } = await unlockedTab();
    const second = freshManager();
    await second.waitForRestore();
    second.lockWeb({ announce: false });

    const rogue = new FakeBroadcastChannel(CHANNEL);
    rogue.postMessage({
      t: 'offer',
      id: 'unsolicited',
      key: first.getCurrentKey(),
      sentAt: Date.now()
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(second.isInitialized()).toBe(false);
  });

  it('does not hand the key over with the lock off or without a key', async () => {
    const { tab: first, wrap } = await unlockedTab();

    first.lockWeb();
    first.offerKeyToPeer('r1');
    expect(posted.filter((message) => message.t === 'offer')).toHaveLength(0);

    await first.loadUserMasterKey(wrap.encryptedMasterKey, wrap.salt, PASSWORD);
    await first.disableWebLock({ password: PASSWORD, ...wrap });
    first.offerKeyToPeer('r2');
    expect(posted.filter((message) => message.t === 'offer')).toHaveLength(0);
  });

  it('does not ask for a key with the lock off or when it already has one', async () => {
    const { tab: first } = await unlockedTab();
    expect(await first.requestKeyFromPeer()).toBe(false);

    ls().removeItem(CONFIG_KEY);
    const second = freshManager();
    expect(await second.requestKeyFromPeer()).toBe(false);
    expect(posted.filter((message) => message.t === 'request')).toHaveLength(0);
  });

  it('degrades to separate unlocks where BroadcastChannel is missing', async () => {
    const { tab: first } = await unlockedTab();
    delete win().BroadcastChannel;

    const second = freshManager();
    expect(await second.waitForRestore()).toBe(false);
    expect(first.isInitialized()).toBe(true);
  });
});
