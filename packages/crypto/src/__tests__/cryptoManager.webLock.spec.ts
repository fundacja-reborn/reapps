import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CryptoManager, type MasterKeyVault } from '../cryptoManager';
import { UNLOCK_THROTTLE_FREE_ATTEMPTS } from '../local-passcode';
import { WEB_LOCK_DEFAULT_TIMEOUT_MS } from '../web-lock';

/**
 * Web App Lock: opt-in lock for an account session in the browser / PWA.
 *
 * Model: while the lock is enabled the master key is never persisted
 * unwrapped - memory only. The account's password-wrapped key (kept by the
 * apps in the credentials record) is the only at-rest form, so a cold start
 * lands locked and the account password unlocks.
 *
 * A fresh `new CryptoManager()` simulates a cold start / another tab; the
 * mocked localStorage is shared between instances like tabs of one origin.
 * The Node test environment has no IndexedDB, so the raw sessionStorage
 * export stands in for "an unwrapped copy at rest".
 */
const CONFIG_KEY = 'reborn_web_lock';
const EPOCH_KEY = 'reborn_web_lock_epoch';
const ACCOUNT_KEY = 'reborn_auth_credentials';
const ATTEMPTS_KEY = 'reborn_unlock_attempts';
const TEMP_KEY = 'TEMP_MASTER_KEY_EXPORT';

const PASSWORD = 'correct horse battery';
const WRONG = 'tr0ub4dor&3';

const freshManager = () => new (CryptoManager as unknown as { new (): CryptoManager })();
const ls = () => (global as unknown as { window: { localStorage: Storage } }).window.localStorage;
const ss = () =>
  (global as unknown as { window: { sessionStorage: Storage } }).window.sessionStorage;

/** An unlocked account session: key in memory + the account wrap for PASSWORD. */
async function accountSession() {
  const m = freshManager();
  const key = await m.generateMasterKey();
  await m.setMasterKey(key);
  const { encryptedMasterKey, salt } = await m.encryptMasterKey(key, PASSWORD);
  // The apps keep the wrap in the credentials record; its presence is what
  // tells the crypto layer an account session exists.
  ls().setItem(ACCOUNT_KEY, JSON.stringify({ id: 'u1' }));
  return { m, wrap: { encryptedMasterKey, salt } };
}

describe('CryptoManager - Web App Lock', () => {
  beforeEach(() => {
    ls().clear();
    ss().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('off by default', () => {
    it('keeps today\'s behaviour: the key is persisted and restored without a prompt', async () => {
      const { m } = await accountSession();
      expect(m.isWebLockEnabled()).toBe(false);
      expect(ss().getItem(TEMP_KEY)).not.toBeNull();

      const cold = freshManager();
      expect(await cold.waitForRestore()).toBe(true);
      expect(cold.isInitialized()).toBe(true);
      expect(cold.isWebLockLocked()).toBe(false);
    });
  });

  describe('enableWebLock', () => {
    it('removes the raw key copy and keeps the session unlocked in memory', async () => {
      const { m, wrap } = await accountSession();

      expect(await m.enableWebLock({ password: PASSWORD, ...wrap })).toBe(true);

      expect(m.isWebLockEnabled()).toBe(true);
      expect(m.getWebLockTimeoutMs()).toBe(WEB_LOCK_DEFAULT_TIMEOUT_MS);
      expect(ss().getItem(TEMP_KEY)).toBeNull();
      expect(m.isInitialized()).toBe(true);
      expect(m.isWebLockLocked()).toBe(false);
    });

    it('refuses a wrong password and changes nothing', async () => {
      const { m, wrap } = await accountSession();

      expect(await m.enableWebLock({ password: WRONG, ...wrap })).toBe(false);

      expect(m.isWebLockEnabled()).toBe(false);
      expect(ls().getItem(CONFIG_KEY)).toBeNull();
      expect(ss().getItem(TEMP_KEY)).not.toBeNull();
    });

    it('refuses a wrap that opens to a different key', async () => {
      const { m } = await accountSession();
      const other = freshManager();
      const foreign = await other.encryptMasterKey(await other.generateMasterKey(), PASSWORD);

      expect(await m.enableWebLock({ password: PASSWORD, ...foreign })).toBe(false);
      expect(m.isWebLockEnabled()).toBe(false);
    });

    it('rolls back and throws when a raw key copy survives the purge', async () => {
      const { m, wrap } = await accountSession();
      vi.spyOn(
        m as unknown as { clearKeyFromIDB: () => Promise<boolean> },
        'clearKeyFromIDB'
      ).mockResolvedValue(false);

      await expect(m.enableWebLock({ password: PASSWORD, ...wrap })).rejects.toThrow(
        'lock not enabled'
      );
      expect(m.isWebLockEnabled()).toBe(false);
      expect(ls().getItem(CONFIG_KEY)).toBeNull();
      expect(m.isInitialized()).toBe(true);
    });

    it('throws without an unlocked key', async () => {
      const m = freshManager();
      ls().setItem(ACCOUNT_KEY, '{}');
      await expect(
        m.enableWebLock({ password: PASSWORD, encryptedMasterKey: 'x', salt: 'y' })
      ).rejects.toThrow('without an unlocked master key');
    });

    it('throws without an account session (local-only mode has no wrap to unlock with)', async () => {
      const m = freshManager();
      const key = await m.generateMasterKey();
      await m.setMasterKey(key);
      const wrap = await m.encryptMasterKey(key, PASSWORD);

      await expect(m.enableWebLock({ password: PASSWORD, ...wrap })).rejects.toThrow(
        'requires an account session'
      );
      expect(m.isWebLockEnabled()).toBe(false);
    });

    it('clamps an unknown idle timeout to the default', async () => {
      const { m, wrap } = await accountSession();
      await m.enableWebLock({ password: PASSWORD, ...wrap, timeoutMs: 123 });
      expect(m.getWebLockTimeoutMs()).toBe(WEB_LOCK_DEFAULT_TIMEOUT_MS);

      m.setWebLockTimeoutMs(60_000);
      expect(m.getWebLockTimeoutMs()).toBe(60_000);
      m.setWebLockTimeoutMs(0);
      expect(m.getWebLockTimeoutMs()).toBe(0);
    });
  });

  describe('restore gate (cold start / reload / new tab)', () => {
    it('stays locked and never reads a leftover raw copy', async () => {
      const { m, wrap } = await accountSession();
      await m.enableWebLock({ password: PASSWORD, ...wrap });
      // A tab that was asleep while the lock was enabled still has its export.
      ss().setItem(TEMP_KEY, 'bGVmdG92ZXI=');

      const cold = freshManager();
      expect(await cold.waitForRestore()).toBe(false);

      expect(cold.isInitialized()).toBe(false);
      expect(cold.isWebLockLocked()).toBe(true);
      expect(ss().getItem(TEMP_KEY)).toBeNull();
    });

    it('unlocks with the account password into memory only', async () => {
      const { m, wrap } = await accountSession();
      const ciphertext = await m.encryptString('written before the lock');
      await m.enableWebLock({ password: PASSWORD, ...wrap });

      const cold = freshManager();
      await cold.waitForRestore();
      expect(await cold.loadUserMasterKey(wrap.encryptedMasterKey, wrap.salt, WRONG)).toBe(false);
      expect(cold.isWebLockLocked()).toBe(true);

      expect(await cold.loadUserMasterKey(wrap.encryptedMasterKey, wrap.salt, PASSWORD)).toBe(
        true
      );
      expect(await cold.decryptString(ciphertext)).toBe('written before the lock');
      expect(ss().getItem(TEMP_KEY)).toBeNull();

      // ...so the next cold start is locked again.
      const next = freshManager();
      expect(await next.waitForRestore()).toBe(false);
    });
  });

  describe('lockWeb', () => {
    it('drops the key and announces the lock to other tabs', async () => {
      const { m, wrap } = await accountSession();
      await m.enableWebLock({ password: PASSWORD, ...wrap });
      const loadedAt = m.getKeyLoadedAt();
      expect(loadedAt).toBeGreaterThan(0);

      m.lockWeb();

      expect(m.isInitialized()).toBe(false);
      expect(m.isWebLockLocked()).toBe(true);
      expect(m.getKeyLoadedAt()).toBe(0);
      expect(Number(ls().getItem(EPOCH_KEY))).toBeGreaterThanOrEqual(loadedAt);
    });

    it('does not re-announce when following another tab', async () => {
      const { m, wrap } = await accountSession();
      await m.enableWebLock({ password: PASSWORD, ...wrap });

      m.lockWeb({ announce: false });

      expect(m.isInitialized()).toBe(false);
      expect(ls().getItem(EPOCH_KEY)).toBeNull();
    });
  });

  describe('disableWebLock', () => {
    it('needs the password, then persists the key again', async () => {
      const { m, wrap } = await accountSession();
      await m.enableWebLock({ password: PASSWORD, ...wrap });

      expect(await m.disableWebLock({ password: WRONG, ...wrap })).toBe(false);
      expect(m.isWebLockEnabled()).toBe(true);

      expect(await m.disableWebLock({ password: PASSWORD, ...wrap })).toBe(true);
      expect(m.isWebLockEnabled()).toBe(false);
      expect(ss().getItem(TEMP_KEY)).not.toBeNull();

      const cold = freshManager();
      expect(await cold.waitForRestore()).toBe(true);
    });

    it('throws when locked', async () => {
      const { m, wrap } = await accountSession();
      await m.enableWebLock({ password: PASSWORD, ...wrap });
      m.lockWeb();
      await expect(m.disableWebLock({ password: PASSWORD, ...wrap })).rejects.toThrow(
        'without an unlocked master key'
      );
    });
  });

  describe('scope', () => {
    it('is inert without an account session, so a leftover config cannot strand a local key', async () => {
      const { m, wrap } = await accountSession();
      await m.enableWebLock({ password: PASSWORD, ...wrap });
      // Logged out without the config being cleared (defence in depth).
      ls().removeItem(ACCOUNT_KEY);
      expect(m.isWebLockEnabled()).toBe(false);

      // Local-only mode generates and persists its key as usual...
      const local = freshManager();
      await local.setMasterKey(await local.generateMasterKey());
      expect(ss().getItem(TEMP_KEY)).not.toBeNull();

      // ...and restores it on the next start.
      const cold = freshManager();
      expect(await cold.waitForRestore()).toBe(true);
    });

    it('is inert on native (a vault is injected)', async () => {
      const { m, wrap } = await accountSession();
      await m.enableWebLock({ password: PASSWORD, ...wrap });

      let stored: string | null = null;
      const vault: MasterKeyVault = {
        save: async (raw) => {
          stored = raw;
        },
        load: async () => stored,
        clear: async () => {
          stored = null;
        }
      };
      const native = freshManager();
      native.setMasterKeyVault(vault);
      expect(native.isWebLockEnabled()).toBe(false);
      await native.setMasterKey(await native.generateMasterKey());
      expect(stored).not.toBeNull();
    });

    it('clearWebLock drops the settings and leaves the key alone', async () => {
      const { m, wrap } = await accountSession();
      await m.enableWebLock({ password: PASSWORD, ...wrap });
      m.lockWeb();
      expect(ls().getItem(EPOCH_KEY)).not.toBeNull();

      m.clearWebLock();

      expect(ls().getItem(CONFIG_KEY)).toBeNull();
      expect(ls().getItem(EPOCH_KEY)).toBeNull();
      expect(m.isWebLockEnabled()).toBe(false);
    });

    it('treats an unreadable config as enabled (fail closed)', async () => {
      const { m } = await accountSession();
      ls().setItem(CONFIG_KEY, 'not json');
      expect(m.isWebLockEnabled()).toBe(true);
      expect(m.getWebLockTimeoutMs()).toBe(WEB_LOCK_DEFAULT_TIMEOUT_MS);
    });
  });

  describe('account-unlock failure throttle', () => {
    it('opens a growing delay after the free attempts and survives a new instance', async () => {
      const m = freshManager();
      for (let i = 0; i < UNLOCK_THROTTLE_FREE_ATTEMPTS - 1; i++) {
        expect(m.recordAccountUnlockFailure()).toBe(0);
      }
      expect(m.getAccountUnlockRetryDelayMs()).toBe(0);

      expect(m.recordAccountUnlockFailure()).toBe(10_000);
      expect(m.getAccountUnlockRetryDelayMs()).toBeGreaterThan(0);
      // A reload does not reset it (the old in-memory counter did).
      expect(freshManager().getAccountUnlockRetryDelayMs()).toBeGreaterThan(0);

      expect(m.recordAccountUnlockFailure()).toBe(20_000);
    });

    it('lets the window run out', async () => {
      vi.useFakeTimers();
      const m = freshManager();
      for (let i = 0; i < UNLOCK_THROTTLE_FREE_ATTEMPTS; i++) m.recordAccountUnlockFailure();
      expect(m.getAccountUnlockRetryDelayMs()).toBe(10_000);

      vi.advanceTimersByTime(10_000);
      expect(m.getAccountUnlockRetryDelayMs()).toBe(0);
    });

    it('is cleared by a correct password and by logout, and is separate from the passcode counter', async () => {
      const { m, wrap } = await accountSession();
      for (let i = 0; i < UNLOCK_THROTTLE_FREE_ATTEMPTS; i++) m.recordAccountUnlockFailure();
      expect(ls().getItem('reborn_local_passcode_attempts')).toBeNull();

      await m.loadUserMasterKey(wrap.encryptedMasterKey, wrap.salt, PASSWORD);
      expect(ls().getItem(ATTEMPTS_KEY)).toBeNull();

      m.recordAccountUnlockFailure();
      m.clearMasterKey();
      expect(ls().getItem(ATTEMPTS_KEY)).toBeNull();
    });
  });
});
