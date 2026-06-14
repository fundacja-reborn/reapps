import { describe, it, expect, beforeEach } from 'vitest';
import { CryptoManager } from '../cryptoManager';

/**
 * Local-mode passcode: optional at-rest wrap of the local master key.
 *
 * Model (planning/local-only-no-account-plan.md, decision A1):
 *  - The local master key is wrapped with PBKDF2(passcode) and only the wrap is
 *    persisted (localStorage `reborn_local_passcode_wrap`).
 *  - The key lives in memory only after unlock - no cleartext at-rest copy - so
 *    a cold start / hard reload lands on the lock screen and re-prompts.
 *
 * Each test uses a fresh `new CryptoManager()` to simulate a cold start; the
 * wrap lives in the shared (mocked) localStorage so a second instance sees it,
 * exactly like a peer app on the same origin. setup.ts clears storage between
 * tests.
 */
const WRAP_KEY = 'reborn_local_passcode_wrap';
const TEMP_KEY = 'TEMP_MASTER_KEY_EXPORT';

// Fresh, non-singleton instance — bypasses getInstance() so each test is a
// clean "process".
const freshManager = () => new (CryptoManager as unknown as { new (): CryptoManager })();

const ls = () => (global as unknown as { window: { localStorage: Storage } }).window.localStorage;
const ss = () => (global as unknown as { window: { sessionStorage: Storage } }).window.sessionStorage;

describe('CryptoManager - local passcode', () => {
  const PASSCODE = 'correct horse';
  const WRONG = 'tr0ub4dor';

  beforeEach(() => {
    // setup.ts already clears storage; double-clear for safety in isolation.
    ls().clear();
    ss().clear();
  });

  describe('enableLocalPasscode', () => {
    it('wraps the key, persists only the wrap, and purges cleartext copies', async () => {
      const m = freshManager();
      const key = await m.generateMasterKey();
      await m.setMasterKey(key);

      // Base mode persisted a raw key export to sessionStorage.
      expect(ss().getItem(TEMP_KEY)).not.toBeNull();

      await m.enableLocalPasscode(PASSCODE);

      // Wrap stored; cleartext session export purged; key still usable in memory.
      const wrap = JSON.parse(ls().getItem(WRAP_KEY) as string);
      expect(wrap.wrapped).toBeTruthy();
      expect(wrap.salt).toBeTruthy();
      expect(wrap.v).toBe(1);
      expect(ss().getItem(TEMP_KEY)).toBeNull();
      expect(m.isInitialized()).toBe(true);
      expect(m.isLocalPasscodeEnabled()).toBe(true);
    });

    it('throws when no master key is loaded', async () => {
      const m = freshManager();
      await expect(m.enableLocalPasscode(PASSCODE)).rejects.toThrow(
        'Cannot set a local passcode without an unlocked master key'
      );
    });

    it('throws on an empty passcode', async () => {
      const m = freshManager();
      await m.setMasterKey(await m.generateMasterKey());
      await expect(m.enableLocalPasscode('')).rejects.toThrow('Passcode must not be empty');
    });
  });

  describe('restore gate (cold start)', () => {
    it('locks a fresh instance when a wrap is present', async () => {
      const setup = freshManager();
      await setup.setMasterKey(await setup.generateMasterKey());
      await setup.enableLocalPasscode(PASSCODE);

      const cold = freshManager();
      const restored = await cold.waitForRestore();

      expect(restored).toBe(false);
      expect(cold.isInitialized()).toBe(false);
      expect(cold.isLocalPasscodeEnabled()).toBe(true);
      expect(cold.isLocalPasscodeLocked()).toBe(true);
    });
  });

  describe('unlockWithLocalPasscode', () => {
    it('unlocks with the correct passcode and decrypts data written before the lock', async () => {
      const setup = freshManager();
      await setup.setMasterKey(await setup.generateMasterKey());
      const ciphertext = await setup.encryptString('note written while unlocked');
      await setup.enableLocalPasscode(PASSCODE);

      const cold = freshManager();
      await cold.waitForRestore();
      const ok = await cold.unlockWithLocalPasscode(PASSCODE);

      expect(ok).toBe(true);
      expect(cold.isInitialized()).toBe(true);
      expect(await cold.decryptString(ciphertext)).toBe('note written while unlocked');
    });

    it('stays memory-only after unlock (no cleartext key persisted)', async () => {
      const setup = freshManager();
      await setup.setMasterKey(await setup.generateMasterKey());
      await setup.enableLocalPasscode(PASSCODE);

      const cold = freshManager();
      await cold.waitForRestore();
      await cold.unlockWithLocalPasscode(PASSCODE);

      // The wrap is still the only on-disk form; no raw key export reappears.
      expect(ss().getItem(TEMP_KEY)).toBeNull();
      expect(ls().getItem(WRAP_KEY)).not.toBeNull();
    });

    it('returns false on a wrong passcode and stays locked', async () => {
      const setup = freshManager();
      await setup.setMasterKey(await setup.generateMasterKey());
      await setup.enableLocalPasscode(PASSCODE);

      const cold = freshManager();
      await cold.waitForRestore();
      const ok = await cold.unlockWithLocalPasscode(WRONG);

      expect(ok).toBe(false);
      expect(cold.isInitialized()).toBe(false);
      expect(cold.isLocalPasscodeLocked()).toBe(true);
    });

    it('returns false when no passcode is set', async () => {
      const m = freshManager();
      expect(await m.unlockWithLocalPasscode(PASSCODE)).toBe(false);
    });
  });

  describe('changeLocalPasscode', () => {
    it('re-wraps with the new passcode; old fails, new works on next cold start', async () => {
      const setup = freshManager();
      await setup.setMasterKey(await setup.generateMasterKey());
      const ciphertext = await setup.encryptString('secret');
      await setup.enableLocalPasscode(PASSCODE);
      // Unlocked session changes the passcode.
      const changed = await setup.changeLocalPasscode(PASSCODE, 'new-pass-9');
      expect(changed).toBe(true);

      const cold = freshManager();
      await cold.waitForRestore();
      expect(await cold.unlockWithLocalPasscode(PASSCODE)).toBe(false); // old no longer works
      expect(await cold.unlockWithLocalPasscode('new-pass-9')).toBe(true);
      expect(await cold.decryptString(ciphertext)).toBe('secret');
    });

    it('returns false when the current passcode is wrong', async () => {
      const m = freshManager();
      await m.setMasterKey(await m.generateMasterKey());
      await m.enableLocalPasscode(PASSCODE);
      expect(await m.changeLocalPasscode(WRONG, 'whatever-1')).toBe(false);
      // Original passcode still valid.
      const cold = freshManager();
      await cold.waitForRestore();
      expect(await cold.unlockWithLocalPasscode(PASSCODE)).toBe(true);
    });
  });

  describe('disableLocalPasscode', () => {
    it('removes the wrap and returns to base mode (auto-unlock on next start)', async () => {
      const setup = freshManager();
      await setup.setMasterKey(await setup.generateMasterKey());
      const ciphertext = await setup.encryptString('data');
      await setup.enableLocalPasscode(PASSCODE);
      await setup.disableLocalPasscode();

      expect(setup.isLocalPasscodeEnabled()).toBe(false);
      expect(ls().getItem(WRAP_KEY)).toBeNull();
      // Base mode re-persists the raw key export.
      expect(ss().getItem(TEMP_KEY)).not.toBeNull();

      // A cold start now auto-restores without a passcode prompt.
      const cold = freshManager();
      const restored = await cold.waitForRestore();
      expect(restored).toBe(true);
      expect(cold.isInitialized()).toBe(true);
      expect(await cold.decryptString(ciphertext)).toBe('data');
    });

    it('throws when called without an unlocked key', async () => {
      const setup = freshManager();
      await setup.setMasterKey(await setup.generateMasterKey());
      await setup.enableLocalPasscode(PASSCODE);

      const cold = freshManager(); // locked
      await cold.waitForRestore();
      await expect(cold.disableLocalPasscode()).rejects.toThrow(
        'Cannot disable the local passcode without an unlocked master key'
      );
    });
  });

  describe('lockLocal', () => {
    it('clears the in-memory key but keeps the wrap, and re-unlock works', async () => {
      const m = freshManager();
      await m.setMasterKey(await m.generateMasterKey());
      const ciphertext = await m.encryptString('locked-data');
      await m.enableLocalPasscode(PASSCODE);

      m.lockLocal({ broadcast: false });

      expect(m.isInitialized()).toBe(false);
      expect(m.isLocalPasscodeLocked()).toBe(true);
      expect(ls().getItem(WRAP_KEY)).not.toBeNull();

      expect(await m.unlockWithLocalPasscode(PASSCODE)).toBe(true);
      expect(await m.decryptString(ciphertext)).toBe('locked-data');
    });
  });

  describe('forgetLocalPasscode', () => {
    it('removes the wrap and clears the in-memory key (reset path)', async () => {
      const setup = freshManager();
      await setup.setMasterKey(await setup.generateMasterKey());
      await setup.enableLocalPasscode(PASSCODE);

      const cold = freshManager(); // locked
      await cold.waitForRestore();
      cold.forgetLocalPasscode();

      expect(cold.isLocalPasscodeEnabled()).toBe(false);
      expect(cold.isInitialized()).toBe(false);
      expect(ls().getItem(WRAP_KEY)).toBeNull();
    });
  });

  describe('setMasterKey clears a stale wrap (account transition)', () => {
    it('removes the local passcode wrap when a fresh at-rest key is established', async () => {
      const m = freshManager();
      await m.setMasterKey(await m.generateMasterKey());
      await m.enableLocalPasscode(PASSCODE);
      expect(m.isLocalPasscodeEnabled()).toBe(true);

      // Simulate logging into an account: a new key is set the normal way.
      await m.setMasterKey(await m.generateMasterKey());

      expect(m.isLocalPasscodeEnabled()).toBe(false);
      expect(ls().getItem(WRAP_KEY)).toBeNull();
    });
  });

  describe('round-trip across enable -> lock -> unlock', () => {
    it('preserves the same key so pre-passcode ciphertext stays readable', async () => {
      const m = freshManager();
      await m.setMasterKey(await m.generateMasterKey());
      const before = await m.encryptString('before passcode');

      await m.enableLocalPasscode(PASSCODE);
      const during = await m.encryptString('after enabling');

      m.lockLocal({ broadcast: false });
      await m.unlockWithLocalPasscode(PASSCODE);

      expect(await m.decryptString(before)).toBe('before passcode');
      expect(await m.decryptString(during)).toBe('after enabling');
    });
  });
});
