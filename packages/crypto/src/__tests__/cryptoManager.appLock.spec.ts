import { describe, it, expect, beforeEach } from 'vitest';
import { CryptoManager, type MasterKeyVault } from '../cryptoManager';

/**
 * Native App Lock: an opt-in biometric gate on reading the vault-backed master
 * key (planning/native-app-lock-biometric-plan.md, guideline 65).
 *
 * Model:
 *  - The key stays in the injected vault (Keystore/Keychain-wrapped on device);
 *    a localStorage flag (`reborn_app_lock_enabled`) tells restore NOT to load
 *    it at cold start. The app shows the biometric lock screen and calls
 *    `unlockFromVault()` after the prompt passes.
 *  - It is a UX gate, not a re-wrap: the at-rest ciphertext is unchanged.
 *
 * These tests inject a fake in-memory vault (the biometric prompt itself lives
 * in the app layer and is out of scope here - crypto only owns the key read).
 * A fresh `new CryptoManager()` simulates a cold start; the flag lives in the
 * shared mocked localStorage and the vault object is shared between instances,
 * exactly like the device key store across app launches.
 */
const APP_LOCK_KEY = 'reborn_app_lock_enabled';
const TEMP_KEY = 'TEMP_MASTER_KEY_EXPORT';

const freshManager = () => new (CryptoManager as unknown as { new (): CryptoManager })();
const ls = () => (global as unknown as { window: { localStorage: Storage } }).window.localStorage;
const ss = () => (global as unknown as { window: { sessionStorage: Storage } }).window.sessionStorage;

/** A shared in-memory stand-in for the device secure-storage vault. */
function makeFakeVault(): MasterKeyVault & { peek: () => string | null } {
  let stored: string | null = null;
  return {
    save: async (raw: string) => {
      stored = raw;
    },
    load: async () => stored,
    clear: async () => {
      stored = null;
    },
    peek: () => stored
  };
}

describe('CryptoManager - App Lock (native biometric gate)', () => {
  beforeEach(() => {
    ls().clear();
    ss().clear();
  });

  describe('enable flag', () => {
    it('toggles isAppLockEnabled via the localStorage marker', () => {
      const m = freshManager();
      expect(m.isAppLockEnabled()).toBe(false);

      m.setAppLockEnabled(true);
      expect(m.isAppLockEnabled()).toBe(true);
      expect(ls().getItem(APP_LOCK_KEY)).toBe('1');

      m.setAppLockEnabled(false);
      expect(m.isAppLockEnabled()).toBe(false);
      expect(ls().getItem(APP_LOCK_KEY)).toBeNull();
    });

    it('isAppLockLocked needs a vault (inert on web)', async () => {
      const m = freshManager(); // no vault injected (web)
      m.setAppLockEnabled(true);
      expect(m.isAppLockEnabled()).toBe(true);
      // No vault -> not "App Lock locked", and restore is not gated by the flag.
      expect(m.isAppLockLocked()).toBe(false);
    });
  });

  describe('restore gate (cold start)', () => {
    it('does NOT auto-read the vault when App Lock is enabled', async () => {
      const vault = makeFakeVault();
      const setup = freshManager();
      setup.setMasterKeyVault(vault);
      await setup.setMasterKey(await setup.generateMasterKey());
      expect(vault.peek()).not.toBeNull(); // key saved to the vault
      setup.setAppLockEnabled(true);

      const cold = freshManager();
      cold.setMasterKeyVault(vault); // same device vault
      const restored = await cold.waitForRestore();

      expect(restored).toBe(false);
      expect(cold.isInitialized()).toBe(false);
      expect(cold.isAppLockLocked()).toBe(true);
      // The key is still in the vault, just not read into memory yet.
      expect(vault.peek()).not.toBeNull();
      // App Lock is a vault gate, not a passcode wrap: no sessionStorage export.
      expect(ss().getItem(TEMP_KEY)).toBeNull();
    });

    it('auto-restores normally when App Lock is disabled', async () => {
      const vault = makeFakeVault();
      const setup = freshManager();
      setup.setMasterKeyVault(vault);
      await setup.setMasterKey(await setup.generateMasterKey());

      const cold = freshManager();
      cold.setMasterKeyVault(vault);
      const restored = await cold.waitForRestore();

      expect(restored).toBe(true);
      expect(cold.isInitialized()).toBe(true);
      expect(cold.isAppLockLocked()).toBe(false);
    });
  });

  describe('unlockFromVault', () => {
    it('reads the key back after the gate and decrypts pre-lock data', async () => {
      const vault = makeFakeVault();
      const setup = freshManager();
      setup.setMasterKeyVault(vault);
      await setup.setMasterKey(await setup.generateMasterKey());
      const ciphertext = await setup.encryptString('note before lock');
      setup.setAppLockEnabled(true);

      const cold = freshManager();
      cold.setMasterKeyVault(vault);
      await cold.waitForRestore();
      expect(cold.isInitialized()).toBe(false);

      const ok = await cold.unlockFromVault();

      expect(ok).toBe(true);
      expect(cold.isInitialized()).toBe(true);
      expect(cold.isAppLockLocked()).toBe(false);
      expect(await cold.decryptString(ciphertext)).toBe('note before lock');
    });

    it('returns false when the vault holds no key', async () => {
      const vault = makeFakeVault(); // empty
      const m = freshManager();
      m.setMasterKeyVault(vault);
      m.setAppLockEnabled(true);

      expect(await m.unlockFromVault()).toBe(false);
      expect(m.isInitialized()).toBe(false);
    });

    it('is a no-op without a vault (web)', async () => {
      const m = freshManager();
      expect(await m.unlockFromVault()).toBe(false);
    });
  });

  describe('lockToVault', () => {
    it('drops the in-memory key but keeps the vault entry; re-unlock works', async () => {
      const vault = makeFakeVault();
      const m = freshManager();
      m.setMasterKeyVault(vault);
      await m.setMasterKey(await m.generateMasterKey());
      const ciphertext = await m.encryptString('locked data');
      m.setAppLockEnabled(true);

      m.lockToVault();

      expect(m.isInitialized()).toBe(false);
      expect(m.isAppLockLocked()).toBe(true);
      expect(vault.peek()).not.toBeNull(); // vault preserved (unlike logout)

      expect(await m.unlockFromVault()).toBe(true);
      expect(await m.decryptString(ciphertext)).toBe('locked data');
    });
  });

  describe('precedence', () => {
    it('a local passcode wrap gates before App Lock (mutually exclusive)', async () => {
      const vault = makeFakeVault();
      const setup = freshManager();
      setup.setMasterKeyVault(vault);
      await setup.setMasterKey(await setup.generateMasterKey());
      // enableLocalPasscode purges the vault and writes the wrap.
      await setup.enableLocalPasscode('correct horse');
      expect(vault.peek()).toBeNull();
      // Even if the App Lock flag is somehow also set, the passcode path wins.
      setup.setAppLockEnabled(true);

      const cold = freshManager();
      cold.setMasterKeyVault(vault);
      const restored = await cold.waitForRestore();

      expect(restored).toBe(false);
      expect(cold.isLocalPasscodeLocked()).toBe(true);
    });
  });

  describe('logout-style clear', () => {
    it('clearMasterKey empties the vault so a stale gate cannot strand the user', async () => {
      const vault = makeFakeVault();
      const m = freshManager();
      m.setMasterKeyVault(vault);
      await m.setMasterKey(await m.generateMasterKey());
      m.setAppLockEnabled(true);

      m.clearMasterKey();
      // The auth store also clears the flag on logout; here we assert the vault
      // is emptied so unlockFromVault would yield no key (the lock screen then
      // falls back to the account password).
      await new Promise((r) => setTimeout(r, 0)); // clearMasterKey's vault clear is async
      expect(vault.peek()).toBeNull();
    });
  });
});
