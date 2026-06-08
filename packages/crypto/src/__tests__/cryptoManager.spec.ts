import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CryptoManager, cryptoManager } from '../cryptoManager';
import * as encryption from '../encryption';

describe('CryptoManager', () => {
  let manager: CryptoManager;

  beforeEach(() => {
    // Clear sessionStorage before each test
    if (global.window?.sessionStorage) {
      global.window.sessionStorage.clear();
    }

    // Get fresh instance
    manager = CryptoManager.getInstance();
    manager.clearMasterKey();
  });

  afterEach(() => {
    // Clean up after each test
    manager.clearMasterKey();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = CryptoManager.getInstance();
      const instance2 = CryptoManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should export singleton instance', () => {
      expect(cryptoManager).toBe(CryptoManager.getInstance());
    });
  });

  describe('initialization', () => {
    it('should not be initialized by default', () => {
      expect(manager.isInitialized()).toBe(false);
    });

    it('should be initialized after setting master key', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);
      expect(manager.isInitialized()).toBe(true);
    });

    it('should not be initialized after clearing master key', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);
      manager.clearMasterKey();
      expect(manager.isInitialized()).toBe(false);
    });
  });

  describe('master key generation', () => {
    it('should generate a valid master key', async () => {
      const masterKey = await manager.generateMasterKey();
      expect(masterKey).toBeDefined();
      expect(masterKey.type).toBe('secret');
      expect(masterKey.algorithm.name).toBe('AES-GCM');
      expect(masterKey.usages).toContain('encrypt');
      expect(masterKey.usages).toContain('decrypt');
    });

    it('should generate different keys each time', async () => {
      const key1 = await manager.generateMasterKey();
      const key2 = await manager.generateMasterKey();

      const exported1 = await encryption.exportKey(key1);
      const exported2 = await encryption.exportKey(key2);

      expect(exported1).not.toEqual(exported2);
    });
  });

  describe('master key encryption/decryption', () => {
    it('should encrypt and decrypt master key with password', async () => {
      const password = 'mySecurePassword123!';
      const originalKey = await manager.generateMasterKey();

      // Encrypt the master key
      const { encryptedMasterKey, salt } = await manager.encryptMasterKey(originalKey, password);
      expect(encryptedMasterKey).toBeDefined();
      expect(salt).toBeDefined();
      expect(typeof encryptedMasterKey).toBe('string');
      expect(typeof salt).toBe('string');

      // Decrypt the master key
      const decryptedKey = await manager.decryptMasterKey(encryptedMasterKey, salt, password);
      expect(decryptedKey).toBeDefined();

      // Compare keys by encrypting/decrypting test data
      await manager.setMasterKey(originalKey);
      const testData = 'test encryption data';
      const encrypted1 = await manager.encryptString(testData);

      await manager.setMasterKey(decryptedKey);
      const decrypted = await manager.decryptString(encrypted1);
      expect(decrypted).toBe(testData);
    });

    it('should fail to decrypt with wrong password', async () => {
      const password = 'correctPassword';
      const wrongPassword = 'wrongPassword';
      const masterKey = await manager.generateMasterKey();

      const { encryptedMasterKey, salt } = await manager.encryptMasterKey(masterKey, password);

      await expect(
        manager.decryptMasterKey(encryptedMasterKey, salt, wrongPassword)
      ).rejects.toThrow('Failed to decrypt master key');
    });
  });

  describe('data encryption/decryption', () => {
    beforeEach(async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);
    });

    describe('encrypt/decrypt methods', () => {
      it('should encrypt and decrypt string data', async () => {
        const plaintext = 'Hello, World!';
        const { encryptedData, iv } = await manager.encrypt(plaintext);

        expect(encryptedData).toBeDefined();
        expect(iv).toBeDefined();
        expect(typeof encryptedData).toBe('string');
        expect(typeof iv).toBe('string');

        const decrypted = await manager.decrypt(encryptedData, iv);
        expect(decrypted).toBe(plaintext);
      });

      it('should encrypt and decrypt object data', async () => {
        const plainObj = { name: 'Test', value: 42, nested: { data: true } };
        const { encryptedData, iv } = await manager.encrypt(plainObj);

        const decrypted = await manager.decrypt(encryptedData, iv, true);
        expect(decrypted).toEqual(plainObj);
      });

      it('should throw error when not initialized', async () => {
        manager.clearMasterKey();

        await expect(manager.encrypt('test')).rejects.toThrow(
          'CryptoManager not initialized with a master key'
        );
        await expect(manager.decrypt('data', 'iv')).rejects.toThrow(
          'CryptoManager not initialized with a master key'
        );
      });
    });

    describe('encryptString/decryptString methods', () => {
      it('should encrypt and decrypt strings', async () => {
        const plaintext = 'Secret message';
        const encrypted = await manager.encryptString(plaintext);

        expect(encrypted).toBeDefined();
        expect(encrypted).toContain(':'); // Should contain IV:encryptedData format

        const decrypted = await manager.decryptString(encrypted);
        expect(decrypted).toBe(plaintext);
      });

      it('should handle empty strings', async () => {
        const encrypted = await manager.encryptString('');
        const decrypted = await manager.decryptString(encrypted);
        expect(decrypted).toBe('');
      });

      it('should handle unicode strings', async () => {
        const plaintext = '🔐 Unicode: ąćęłńóśźż';
        const encrypted = await manager.encryptString(plaintext);
        const decrypted = await manager.decryptString(encrypted);
        expect(decrypted).toBe(plaintext);
      });

      it('should throw error for invalid encrypted format', async () => {
        await expect(manager.decryptString('invalid-format')).rejects.toThrow(
          'Invalid encrypted value format'
        );
        await expect(manager.decryptString('')).rejects.toThrow('Invalid encrypted value format');
      });
    });

    describe('encryptObject/decryptObject methods', () => {
      it('should encrypt and decrypt objects', async () => {
        const plainObj = {
          id: '123',
          name: 'Test Object',
          data: [1, 2, 3],
          metadata: { created: new Date().toISOString() }
        };

        const encrypted = await manager.encryptObject(plainObj);
        expect(encrypted).toContain(':');

        const decrypted = await manager.decryptObject(encrypted);
        expect(decrypted).toEqual(plainObj);
      });

      it('should handle complex nested objects', async () => {
        const complexObj = {
          level1: {
            level2: {
              level3: {
                arrays: [
                  [1, 2],
                  [3, 4]
                ],
                objects: [{ a: 1 }, { b: 2 }]
              }
            }
          }
        };

        const encrypted = await manager.encryptObject(complexObj);
        const decrypted = await manager.decryptObject(encrypted);
        expect(decrypted).toEqual(complexObj);
      });
    });

    describe('encryptText/decryptText methods', () => {
      it('should encrypt and decrypt text', async () => {
        const text = 'This is a text message';
        const encrypted = await manager.encryptText(text);
        const decrypted = await manager.decryptText(encrypted);
        expect(decrypted).toBe(text);
      });

      it('should encrypt empty string and decrypt back', async () => {
        const encrypted = await manager.encryptText('');
        expect(encrypted).not.toBe('');
        expect(await manager.decryptText(encrypted)).toBe('');
      });

      it('should return empty string for empty decryptText input', async () => {
        expect(await manager.decryptText('')).toBe('');
      });
    });
  });

  describe('key persistence', () => {
    it('should save master key to sessionStorage', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      const savedKey = global.window?.sessionStorage.getItem('TEMP_MASTER_KEY_EXPORT');
      expect(savedKey).toBeDefined();
      expect(typeof savedKey).toBe('string');
    });

    it('should clear key from sessionStorage on clearMasterKey', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      manager.clearMasterKey();

      const savedKey = global.window?.sessionStorage.getItem('TEMP_MASTER_KEY_EXPORT');
      expect(savedKey).toBeNull();
    });

    it('should restore key from sessionStorage on new instance', async () => {
      // Set up a key and verify it
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);
      await manager.verifyEncryption();

      // Encrypt test data with original instance
      const testData = 'test persistence';
      const encrypted = await manager.encryptString(testData);

      // Force create a new instance by clearing the singleton
      const newManager = new (CryptoManager as any)();

      // Use waitForRestore instead of setTimeout
      await newManager.waitForRestore();

      // Check if key was restored
      if (newManager.isInitialized()) {
        const decrypted = await newManager.decryptString(encrypted);
        expect(decrypted).toBe(testData);
      }
    });
  });

  describe('key verification', () => {
    it('should verify encryption functionality', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      const verified = await manager.verifyEncryption();
      expect(verified).toBe(true);
      expect(manager.isKeyVerified()).toBe(true);
    });

    it('should fail verification without initialized key', async () => {
      await expect(manager.verifyEncryption()).rejects.toThrow(
        'Cannot verify encryption without initialized key'
      );
    });

    it('should mark verification status in sessionStorage', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);
      await manager.verifyEncryption();

      const verificationStatus = global.window?.sessionStorage.getItem(
        'CRYPTO_VERIFICATION_SUCCESS'
      );

      expect(verificationStatus).toBe('true');
    });

    it('should clear verification status on clearMasterKey', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);
      await manager.verifyEncryption();

      manager.clearMasterKey();

      const verificationStatus = global.window?.sessionStorage.getItem(
        'CRYPTO_VERIFICATION_SUCCESS'
      );
      expect(verificationStatus).toBeNull();
    });
  });

  describe('initWithKey', () => {
    it('should initialize with a string key', async () => {
      const stringKey = 'mySecretKey123456789012345678901'; // 32 chars
      await manager.initWithKey(stringKey);

      expect(manager.isInitialized()).toBe(true);

      // Test encryption works
      const testData = 'test with string key';
      const encrypted = await manager.encryptString(testData);
      const decrypted = await manager.decryptString(encrypted);
      expect(decrypted).toBe(testData);
    });

    it('should handle short keys by padding', async () => {
      const shortKey = 'shortKey';
      await manager.initWithKey(shortKey);

      expect(manager.isInitialized()).toBe(true);
    });

    it('should handle long keys by truncating', async () => {
      const longKey = 'a'.repeat(50);
      await manager.initWithKey(longKey);

      expect(manager.isInitialized()).toBe(true);
    });
  });

  describe('exportCurrentKey', () => {
    it('should export the current master key', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      const exported = await manager.exportCurrentKey();
      expect(exported).toBeInstanceOf(ArrayBuffer);
      expect(exported!.byteLength).toBe(32); // 256 bits
    });

    it('should return null when no key is loaded', async () => {
      const exported = await manager.exportCurrentKey();
      expect(exported).toBeNull();
    });
  });

  describe('getCurrentKey', () => {
    it('should return the current master key', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      const currentKey = manager.getCurrentKey();
      expect(currentKey).toBe(masterKey);
    });

    it('should return null when no key is loaded', () => {
      const currentKey = manager.getCurrentKey();
      expect(currentKey).toBeNull();
    });
  });

  describe('wasKeyRestoreAttempted', () => {
    it('should be false until waitForRestore() is called (lazy init)', async () => {
      // Restoration is now deferred until the first ensureRestoreStarted()
      // call (guideline 59 rule #12) so that the public share view, which
      // imports @reborn/crypto without ever needing the master key, doesn't
      // allocate the reborn_crypto_keys IndexedDB for anonymous viewers.
      const newManager = new (CryptoManager as any)();
      expect(newManager.wasKeyRestoreAttempted()).toBe(false);

      await newManager.waitForRestore();
      expect(newManager.wasKeyRestoreAttempted()).toBe(true);
    });

    it('should be true after restore when key was saved', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      const newManager = new (CryptoManager as any)();
      await newManager.waitForRestore();

      expect(newManager.wasKeyRestoreAttempted()).toBe(true);
    });
  });

  describe('waitForRestore', () => {
    it('should resolve to false when no key is stored', async () => {
      const result = await manager.waitForRestore();
      expect(result).toBe(false);
    });

    it('should resolve to true when key is successfully restored', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      const newManager = new (CryptoManager as any)();
      const result = await newManager.waitForRestore();

      expect(result).toBe(true);
      expect(newManager.isInitialized()).toBe(true);
    });

    it('should be idempotent — multiple calls return same result', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      const newManager = new (CryptoManager as any)();
      const result1 = await newManager.waitForRestore();
      const result2 = await newManager.waitForRestore();

      expect(result1).toBe(result2);
    });

    it('does not emit a spurious timeout warning after restore resolves', async () => {
      // Restore resolves fast (no key stored → returns false in <100ms). The
      // setTimeout used by waitForRestore must be cleared so the warning
      // callback never runs after the race has been won. The logger emits
      // through console.log, so spy there and filter for the warning text.
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {/* swallow log output */});

      const newManager = new (CryptoManager as any)();
      const result = await newManager.waitForRestore();
      expect(result).toBe(false);

      // Wait past the 5s RESTORE_TIMEOUT_MS in real time. If the timer were
      // still scheduled the warning would land in this window. 5.5 s real
      // sleep is acceptable for one regression test — the race is timing-
      // sensitive enough that fake timers can't reliably reproduce it.
      await new Promise((resolve) => setTimeout(resolve, 5_500));

      const timeoutWarnings = consoleSpy.mock.calls.filter((args) =>
        args.some((a) => typeof a === 'string' && a.includes('timed out'))
      );
      expect(timeoutWarnings).toHaveLength(0);

      consoleSpy.mockRestore();
    }, 10_000);
  });

  describe('cross-app key events (BroadcastChannel)', () => {
    interface FakeChannel {
      postMessage: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      onmessage: ((e: { data: unknown }) => void) | null;
    }
    let createdChannels: FakeChannel[];
    let originalBroadcastChannel: unknown;

    beforeEach(() => {
      createdChannels = [];
      originalBroadcastChannel = (globalThis as any).BroadcastChannel;
      // Use a real class — vi.fn arrow form doesn't work with `new`.
      class MockBroadcastChannel implements FakeChannel {
        postMessage = vi.fn();
        close = vi.fn();
        onmessage: ((e: { data: unknown }) => void) | null = null;
        constructor(_name: string) {
          createdChannels.push(this);
        }
      }
      (globalThis as any).BroadcastChannel = MockBroadcastChannel;
    });

    afterEach(() => {
      (globalThis as any).BroadcastChannel = originalBroadcastChannel;
    });

    it('broadcasts "unlocked" after setMasterKey', async () => {
      const fresh = new (CryptoManager as any)();
      const key = await fresh.generateMasterKey();
      await fresh.setMasterKey(key);

      expect(createdChannels).toHaveLength(1);
      expect(createdChannels[0].postMessage).toHaveBeenCalledWith({ type: 'unlocked' });
    });

    it('broadcasts "cleared" after clearMasterKey', async () => {
      const fresh = new (CryptoManager as any)();
      const key = await fresh.generateMasterKey();
      await fresh.setMasterKey(key);
      const calls = createdChannels[0].postMessage.mock.calls.length;

      fresh.clearMasterKey();

      expect(createdChannels[0].postMessage.mock.calls.length).toBe(calls + 1);
      expect(createdChannels[0].postMessage).toHaveBeenLastCalledWith({ type: 'cleared' });
    });

    it('reuses a single BroadcastChannel across multiple subscribers', () => {
      const fresh = new (CryptoManager as any)();
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      const unsubA = fresh.subscribeToKeyEvents(handlerA);
      const unsubB = fresh.subscribeToKeyEvents(handlerB);

      expect(createdChannels).toHaveLength(1);

      // Simulate a peer broadcast — invoke the channel's onmessage directly.
      createdChannels[0].onmessage?.({ data: { type: 'unlocked' } });

      expect(handlerA).toHaveBeenCalledWith('unlocked');
      expect(handlerB).toHaveBeenCalledWith('unlocked');

      unsubA();
      createdChannels[0].onmessage?.({ data: { type: 'cleared' } });

      expect(handlerA).toHaveBeenCalledTimes(1); // unsubscribed → no new call
      expect(handlerB).toHaveBeenCalledWith('cleared');

      unsubB();
    });

    it('degrades silently when BroadcastChannel constructor throws', async () => {
      class ThrowingChannel {
        constructor() {
          throw new Error('sandboxed');
        }
      }
      (globalThis as any).BroadcastChannel = ThrowingChannel;

      const fresh = new (CryptoManager as any)();
      const key = await fresh.generateMasterKey();

      // Must not throw — degraded mode just skips the broadcast.
      await expect(fresh.setMasterKey(key)).resolves.toBeUndefined();
      expect(fresh.isInitialized()).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle encryption errors gracefully', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      // Mock encryption to throw error
      vi.spyOn(encryption, 'encryptData').mockRejectedValueOnce(new Error('Encryption failed'));

      await expect(manager.encrypt('test')).rejects.toThrow('Failed to encrypt data');
    });

    it('should handle decryption errors gracefully', async () => {
      const masterKey = await manager.generateMasterKey();
      await manager.setMasterKey(masterKey);

      // Mock decryption to throw error
      vi.spyOn(encryption, 'decryptData').mockRejectedValueOnce(new Error('Decryption failed'));

      await expect(manager.decrypt('data', 'iv')).rejects.toThrow('Failed to decrypt data');
    });
  });
});
