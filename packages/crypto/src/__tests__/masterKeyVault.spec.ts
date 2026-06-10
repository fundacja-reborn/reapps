/**
 * MasterKeyVault (native persistence) tests.
 *
 * With a vault injected (native shells), the CryptoManager must persist the
 * master key ONLY through the vault - no extractable CryptoKey in IndexedDB,
 * no raw Base64 export in sessionStorage - and must migrate/purge copies left
 * by pre-vault builds. Without a vault (web) the behavior is unchanged and
 * covered by cryptoManager.spec.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { CryptoManager, type MasterKeyVault } from '../cryptoManager';
import { arrayBufferToBase64 } from '../encryption';

const TEMP_KEY = 'TEMP_MASTER_KEY_EXPORT';

/** In-memory vault double with call tracking. */
function createFakeVault(): { vault: MasterKeyVault; state: { stored: string | null } } {
  const state: { stored: string | null } = { stored: null };
  const vault: MasterKeyVault = {
    save: vi.fn(async (rawKeyBase64: string) => {
      state.stored = rawKeyBase64;
    }),
    load: vi.fn(async () => state.stored),
    clear: vi.fn(async () => {
      state.stored = null;
    })
  };
  return { vault, state };
}

function freshManager(): CryptoManager {
  // Bypass the singleton - each test wants an isolated instance.
  return new (CryptoManager as unknown as { new (): CryptoManager })();
}

describe('CryptoManager with MasterKeyVault (native persistence)', () => {
  describe('setMasterKey', () => {
    it('persists the raw key (Base64) to the vault', async () => {
      const { vault, state } = createFakeVault();
      const manager = freshManager();
      manager.setMasterKeyVault(vault);

      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      expect(vault.save).toHaveBeenCalledTimes(1);
      const exported = await manager.exportCurrentKey();
      expect(state.stored).toBe(arrayBufferToBase64(new Uint8Array(exported!)));
    });

    it('does NOT write the raw key to sessionStorage in vault mode', async () => {
      const { vault } = createFakeVault();
      const manager = freshManager();
      manager.setMasterKeyVault(vault);

      await manager.setMasterKey(await manager.generateMasterKey());

      expect(global.window?.sessionStorage.getItem(TEMP_KEY)).toBeNull();
    });

    it('still runs the encryption self-test in vault mode', async () => {
      const { vault } = createFakeVault();
      const manager = freshManager();
      manager.setMasterKeyVault(vault);

      await manager.setMasterKey(await manager.generateMasterKey());

      expect(manager.isKeyVerified()).toBe(true);
    });

    it('keeps the in-memory key usable when the vault write fails', async () => {
      const manager = freshManager();
      manager.setMasterKeyVault({
        save: vi.fn(async () => {
          throw new Error('keystore unavailable');
        }),
        load: vi.fn(async () => null),
        clear: vi.fn(async () => undefined)
      });

      await manager.setMasterKey(await manager.generateMasterKey());

      expect(manager.isInitialized()).toBe(true);
      const encrypted = await manager.encryptString('still works');
      expect(await manager.decryptString(encrypted)).toBe('still works');
    });
  });

  describe('restore', () => {
    it('restores the key from the vault on a fresh instance', async () => {
      const { vault } = createFakeVault();
      const writer = freshManager();
      writer.setMasterKeyVault(vault);
      await writer.setMasterKey(await writer.generateMasterKey());
      const encrypted = await writer.encryptString('vault roundtrip');

      const reader = freshManager();
      reader.setMasterKeyVault(vault);
      const restored = await reader.waitForRestore();

      expect(restored).toBe(true);
      expect(reader.isInitialized()).toBe(true);
      expect(await reader.decryptString(encrypted)).toBe('vault roundtrip');
    });

    it('resolves false on an empty vault', async () => {
      const { vault } = createFakeVault();
      const manager = freshManager();
      manager.setMasterKeyVault(vault);

      expect(await manager.waitForRestore()).toBe(false);
      expect(manager.isInitialized()).toBe(false);
    });

    it('clears a corrupt vault entry and falls back to "no key"', async () => {
      const { vault, state } = createFakeVault();
      // Valid Base64 but not a valid AES-256 raw key (wrong length).
      state.stored = arrayBufferToBase64(new Uint8Array(5));

      const manager = freshManager();
      manager.setMasterKeyVault(vault);
      const restored = await manager.waitForRestore();

      expect(restored).toBe(false);
      expect(manager.isInitialized()).toBe(false);
      expect(vault.clear).toHaveBeenCalled();
      expect(state.stored).toBeNull();
    });

    it('degrades to "no key" when vault.load rejects', async () => {
      const manager = freshManager();
      const clear = vi.fn(async () => undefined);
      manager.setMasterKeyVault({
        save: vi.fn(async () => undefined),
        load: vi.fn(async () => {
          throw new Error('keystore unavailable');
        }),
        clear
      });

      expect(await manager.waitForRestore()).toBe(false);
      // A transient read error must not destroy the (possibly fine) entry.
      expect(clear).not.toHaveBeenCalled();
    });

    it('purges the legacy sessionStorage raw-key copy in vault mode', async () => {
      global.window?.sessionStorage.setItem(TEMP_KEY, 'legacy-pre-vault-copy');
      const { vault } = createFakeVault();
      const manager = freshManager();
      manager.setMasterKeyVault(vault);

      await manager.waitForRestore();

      expect(global.window?.sessionStorage.getItem(TEMP_KEY)).toBeNull();
    });
  });

  describe('legacy IndexedDB migration', () => {
    it('moves a pre-vault IDB key into the vault and purges the IDB copy', async () => {
      const { vault, state } = createFakeVault();
      const seed = freshManager();
      const legacyKey = await seed.generateMasterKey();

      // The node test env has no IndexedDB - satisfy the migration guard and
      // stub the private IDB accessors (their real IO is exercised on web).
      (globalThis as { indexedDB?: unknown }).indexedDB = {};
      try {
        const manager = freshManager();
        manager.setMasterKeyVault(vault);
        const restoreIdb = vi
          .spyOn(manager as unknown as { restoreKeyFromIDB: () => Promise<CryptoKey | null> }, 'restoreKeyFromIDB')
          .mockResolvedValue(legacyKey);
        const clearIdb = vi
          .spyOn(manager as unknown as { clearKeyFromIDB: () => Promise<void> }, 'clearKeyFromIDB')
          .mockResolvedValue(undefined);

        const restored = await manager.waitForRestore();

        expect(restored).toBe(true);
        expect(restoreIdb).toHaveBeenCalled();
        expect(vault.save).toHaveBeenCalledTimes(1);
        expect(state.stored).not.toBeNull();
        expect(clearIdb).toHaveBeenCalled();
        expect(manager.isInitialized()).toBe(true);
      } finally {
        delete (globalThis as { indexedDB?: unknown }).indexedDB;
      }
    });

    it('purges (without migrating) a legacy IDB key that fails verification', async () => {
      const { vault } = createFakeVault();
      const seed = freshManager();
      const legacyKey = await seed.generateMasterKey();

      (globalThis as { indexedDB?: unknown }).indexedDB = {};
      try {
        const manager = freshManager();
        manager.setMasterKeyVault(vault);
        vi.spyOn(
          manager as unknown as { restoreKeyFromIDB: () => Promise<CryptoKey | null> },
          'restoreKeyFromIDB'
        ).mockResolvedValue(legacyKey);
        const clearIdb = vi
          .spyOn(manager as unknown as { clearKeyFromIDB: () => Promise<void> }, 'clearKeyFromIDB')
          .mockResolvedValue(undefined);
        vi.spyOn(manager, 'verifyEncryption').mockRejectedValueOnce(new Error('broken key'));

        const restored = await manager.waitForRestore();

        expect(restored).toBe(false);
        expect(manager.isInitialized()).toBe(false);
        expect(vault.save).not.toHaveBeenCalled();
        expect(clearIdb).toHaveBeenCalled();
      } finally {
        delete (globalThis as { indexedDB?: unknown }).indexedDB;
      }
    });
  });

  describe('clearMasterKey', () => {
    it('clears the vault entry on logout', async () => {
      const { vault, state } = createFakeVault();
      const manager = freshManager();
      manager.setMasterKeyVault(vault);
      await manager.setMasterKey(await manager.generateMasterKey());
      expect(state.stored).not.toBeNull();

      manager.clearMasterKey();
      // clear() is fire-and-forget - yield to the microtask queue.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vault.clear).toHaveBeenCalled();
      expect(state.stored).toBeNull();
      expect(manager.isInitialized()).toBe(false);
    });
  });

  describe('setMasterKeyVault ordering guard', () => {
    it('warns when the vault is injected after restoration has started', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        /* swallow log output */
      });
      try {
        const manager = freshManager();
        await manager.waitForRestore();
        manager.setMasterKeyVault(createFakeVault().vault);

        const warned = consoleSpy.mock.calls.some((args) =>
          args.some(
            (a) => typeof a === 'string' && a.includes('after key restoration started')
          )
        );
        expect(warned).toBe(true);
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });
});
