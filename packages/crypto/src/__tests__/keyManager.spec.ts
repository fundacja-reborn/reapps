import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateMasterKeyForUser,
  loadUserMasterKey,
  clearMasterKey,
  isMasterKeyLoaded,
  isKeyVerified,
  wasKeyRestoreAttempted,
  verifyMasterKey,
  encryptWithMasterKey,
  decryptString,
  decryptObject
} from '../keyManager';
import { cryptoManager } from '../cryptoManager';

describe('KeyManager', () => {
  beforeEach(() => {
    // Clear any existing keys before each test
    clearMasterKey();

    // Clear sessionStorage
    if (global.window?.sessionStorage) {
      global.window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    // Clean up after each test
    clearMasterKey();
  });

  describe('generateMasterKeyForUser', () => {
    it('should generate encrypted master key for new user', async () => {
      const password = 'userPassword123!';
      const result = await generateMasterKeyForUser(password);

      expect(result).toBeDefined();
      expect(result.encryptedMasterKey).toBeDefined();
      expect(result.salt).toBeDefined();
      expect(typeof result.encryptedMasterKey).toBe('string');
      expect(typeof result.salt).toBe('string');

      // Should be base64 encoded strings
      expect(result.encryptedMasterKey.length).toBeGreaterThan(0);
      expect(result.salt.length).toBeGreaterThan(0);
    });

    it('should generate different keys for same password', async () => {
      const password = 'samePassword123!';
      const result1 = await generateMasterKeyForUser(password);
      const result2 = await generateMasterKeyForUser(password);

      // Different salts should produce different encrypted keys
      expect(result1.salt).not.toBe(result2.salt);
      expect(result1.encryptedMasterKey).not.toBe(result2.encryptedMasterKey);
    });

    it('should handle empty password', async () => {
      const result = await generateMasterKeyForUser('');

      expect(result).toBeDefined();
      expect(result.encryptedMasterKey).toBeDefined();
      expect(result.salt).toBeDefined();
    });

    it('should handle unicode password', async () => {
      const password = '🔐 パスワード مرور رمز';
      const result = await generateMasterKeyForUser(password);

      expect(result).toBeDefined();
      expect(result.encryptedMasterKey).toBeDefined();
      expect(result.salt).toBeDefined();
    });
  });

  describe('loadUserMasterKey', () => {
    let encryptedKey: string;
    let salt: string;
    const password = 'testPassword123!';

    beforeEach(async () => {
      // Generate a master key to test loading
      const result = await generateMasterKeyForUser(password);
      encryptedKey = result.encryptedMasterKey;
      salt = result.salt;
    });

    it('should load and decrypt master key with correct password', async () => {
      const loaded = await loadUserMasterKey(encryptedKey, salt, password);

      expect(loaded).toBe(true);
      expect(isMasterKeyLoaded()).toBe(true);
      expect(isKeyVerified()).toBe(true);
    });

    it('should fail to load with wrong password', async () => {
      const loaded = await loadUserMasterKey(encryptedKey, salt, 'wrongPassword');

      expect(loaded).toBe(false);
      expect(isMasterKeyLoaded()).toBe(false);
    });

    it('should fail with missing encrypted key', async () => {
      const loaded = await loadUserMasterKey('', salt, password);

      expect(loaded).toBe(false);
      expect(isMasterKeyLoaded()).toBe(false);
    });

    it('should fail with missing salt', async () => {
      const loaded = await loadUserMasterKey(encryptedKey, '', password);

      expect(loaded).toBe(false);
      expect(isMasterKeyLoaded()).toBe(false);
    });

    it('should fail with invalid encrypted key format', async () => {
      const loaded = await loadUserMasterKey('invalid-key-format', salt, password);

      expect(loaded).toBe(false);
      expect(isMasterKeyLoaded()).toBe(false);
    });

    it('should verify the loaded key', async () => {
      const loaded = await loadUserMasterKey(encryptedKey, salt, password);

      expect(loaded).toBe(true);

      // Test that encryption/decryption works
      const testData = 'verify loaded key works';
      const encrypted = await encryptWithMasterKey(testData);
      const decrypted = await decryptString(encrypted);
      expect(decrypted).toBe(testData);
    });
  });

  describe('master key state management', () => {
    it('should clear master key', async () => {
      // Load a key first
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      expect(isMasterKeyLoaded()).toBe(true);

      clearMasterKey();

      expect(isMasterKeyLoaded()).toBe(false);
      expect(isKeyVerified()).toBe(false);
    });

    it('should track key loaded state', async () => {
      expect(isMasterKeyLoaded()).toBe(false);

      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      expect(isMasterKeyLoaded()).toBe(true);
    });

    it('should track key verification state', async () => {
      expect(isKeyVerified()).toBe(false);

      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      expect(isKeyVerified()).toBe(true);
    });

    it('should track key restore attempts', () => {
      expect(wasKeyRestoreAttempted()).toBe(cryptoManager.wasKeyRestoreAttempted());
    });
  });

  describe('verifyMasterKey', () => {
    it('should verify a loaded key', async () => {
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      const verified = await verifyMasterKey();
      expect(verified).toBe(true);
    });

    it('should return false when no key is loaded', async () => {
      const verified = await verifyMasterKey();
      expect(verified).toBe(false);
    });

    it('should clear corrupted key on failed verification', async () => {
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      // Mock verification to fail
      vi.spyOn(cryptoManager, 'verifyEncryption').mockRejectedValueOnce(
        new Error('Verification failed')
      );

      const verified = await verifyMasterKey();
      expect(verified).toBe(false);
      expect(isMasterKeyLoaded()).toBe(false);
    });
  });

  describe('data encryption/decryption', () => {
    beforeEach(async () => {
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');
    });

    describe('encryptWithMasterKey', () => {
      it('should encrypt string data', async () => {
        const plaintext = 'Hello, World!';
        const encrypted = await encryptWithMasterKey(plaintext);

        expect(encrypted).toBeDefined();
        expect(encrypted).toContain(':');
        expect(encrypted).not.toBe(plaintext);
      });

      it('should encrypt object data', async () => {
        const plainObj = { name: 'Test', value: 42 };
        const encrypted = await encryptWithMasterKey(plainObj);

        expect(encrypted).toBeDefined();
        expect(encrypted).toContain(':');
      });

      it('should throw error when key not loaded', async () => {
        clearMasterKey();

        await expect(encryptWithMasterKey('test')).rejects.toThrow('Master key not loaded');
      });
    });

    describe('decryptString', () => {
      it('should decrypt encrypted strings', async () => {
        const plaintext = 'Secret message';
        const encrypted = await encryptWithMasterKey(plaintext);
        const decrypted = await decryptString(encrypted);

        expect(decrypted).toBe(plaintext);
      });

      it('should handle empty strings', async () => {
        const encrypted = await encryptWithMasterKey('');
        const decrypted = await decryptString(encrypted);

        expect(decrypted).toBe('');
      });

      it('should handle unicode strings', async () => {
        const plaintext = '🔐 Unicode: ąćęłńóśźż';
        const encrypted = await encryptWithMasterKey(plaintext);
        const decrypted = await decryptString(encrypted);

        expect(decrypted).toBe(plaintext);
      });

      it('should throw error when key not loaded', async () => {
        clearMasterKey();

        await expect(decryptString('iv:data')).rejects.toThrow('Master key not loaded');
      });
    });

    describe('decryptObject', () => {
      it('should decrypt encrypted objects', async () => {
        const plainObj = {
          id: '123',
          name: 'Test Object',
          nested: { value: true }
        };
        const encrypted = await encryptWithMasterKey(plainObj);
        const decrypted = await decryptObject(encrypted);

        expect(decrypted).toEqual(plainObj);
      });

      it('should handle arrays', async () => {
        const plainArray = [1, 2, 3, { a: 'b' }];
        const encrypted = await encryptWithMasterKey(plainArray);
        const decrypted = await decryptObject(encrypted);

        expect(decrypted).toEqual(plainArray);
      });

      it('should throw error when key not loaded', async () => {
        clearMasterKey();

        await expect(decryptObject('iv:data')).rejects.toThrow('Master key not loaded');
      });
    });
  });

  describe('error handling', () => {
    it('should handle key generation errors', async () => {
      // Mock generateMasterKey to throw
      vi.spyOn(cryptoManager, 'generateMasterKey').mockRejectedValueOnce(
        new Error('Generation failed')
      );

      await expect(generateMasterKeyForUser('password')).rejects.toThrow(
        'Failed to generate master key'
      );
    });

    it('should handle encryption errors', async () => {
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      // Mock encryptString to throw
      vi.spyOn(cryptoManager, 'encryptString').mockRejectedValueOnce(
        new Error('Encryption failed')
      );

      await expect(encryptWithMasterKey('test')).rejects.toThrow();
    });

    it('should handle decryption errors gracefully', async () => {
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      // Mock decryptString to throw
      vi.spyOn(cryptoManager, 'decryptString').mockRejectedValueOnce(
        new Error('Decryption failed')
      );

      await expect(decryptString('iv:data')).rejects.toThrow();
    });
  });

  describe('integration tests', () => {
    it('should handle complete user registration and login flow', async () => {
      // Registration: Generate master key for new user
      const password = 'userPassword123!';
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser(password);

      // Save to "database" (in real app)
      const userData = { encryptedMasterKey, salt };

      // Clear key to simulate fresh login
      clearMasterKey();
      expect(isMasterKeyLoaded()).toBe(false);

      // Login: Load master key
      const loginSuccess = await loadUserMasterKey(
        userData.encryptedMasterKey,
        userData.salt,
        password
      );

      expect(loginSuccess).toBe(true);
      expect(isMasterKeyLoaded()).toBe(true);
      expect(isKeyVerified()).toBe(true);

      // Use the key to encrypt user data
      const userSecret = 'My secret data';
      const encryptedSecret = await encryptWithMasterKey(userSecret);

      // Decrypt to verify
      const decryptedSecret = await decryptString(encryptedSecret);
      expect(decryptedSecret).toBe(userSecret);

      // Logout
      clearMasterKey();
      expect(isMasterKeyLoaded()).toBe(false);

      // Try to decrypt after logout (should fail)
      await expect(decryptString(encryptedSecret)).rejects.toThrow('Master key not loaded');
    });

    it('should handle password change flow', async () => {
      // Initial setup
      const oldPassword = 'oldPassword123!';
      const newPassword = 'newPassword456!';

      // Generate initial master key
      const { encryptedMasterKey: oldEncrypted, salt: oldSalt } =
        await generateMasterKeyForUser(oldPassword);

      // Load the key
      await loadUserMasterKey(oldEncrypted, oldSalt, oldPassword);

      // Get the current master key to re-encrypt with new password
      const currentKey = cryptoManager.getCurrentKey();
      expect(currentKey).not.toBeNull();

      // Re-encrypt master key with new password
      const { encryptedMasterKey: newEncrypted, salt: newSalt } =
        await cryptoManager.encryptMasterKey(currentKey!, newPassword);

      // Clear and try to load with new password
      clearMasterKey();
      const loaded = await loadUserMasterKey(newEncrypted, newSalt, newPassword);

      expect(loaded).toBe(true);
      expect(isMasterKeyLoaded()).toBe(true);
    });
  });
});
