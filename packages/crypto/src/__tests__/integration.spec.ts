import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateMasterKeyForUser,
  loadUserMasterKey,
  encryptWithMasterKey,
  decryptString,
  decryptObject,
  clearMasterKey,
  isMasterKeyLoaded
} from '../keyManager';
import { cryptoManager } from '../cryptoManager';

describe('E2E Encryption Integration Tests', () => {
  beforeEach(() => {
    clearMasterKey();
  });

  describe('Complete user workflow', () => {
    it('should handle full registration -> encryption -> logout -> login -> decryption flow', async () => {
      // 1. User Registration
      const userPassword = 'MySecurePassword123!';
      const registrationResult = await generateMasterKeyForUser(userPassword);

      // Simulate saving to database
      const userRecord = {
        id: 'user-123',
        username: 'testuser',
        encryptedMasterKey: registrationResult.encryptedMasterKey,
        salt: registrationResult.salt
      };

      // Load the key after generation to be able to encrypt data
      await loadUserMasterKey(
        registrationResult.encryptedMasterKey,
        registrationResult.salt,
        userPassword
      );

      // 2. Encrypt user data
      const userData = {
        tasks: [
          { id: '1', title: 'Buy groceries', completed: false },
          { id: '2', title: 'Call mom', completed: true }
        ],
        notes: [
          { id: '1', content: 'Remember to buy milk' },
          { id: '2', content: 'Meeting at 3 PM' }
        ],
        settings: {
          theme: 'dark',
          notifications: true,
          language: 'en'
        }
      };

      const encryptedTasks = await encryptWithMasterKey(userData.tasks);
      const encryptedNotes = await encryptWithMasterKey(userData.notes);
      const encryptedSettings = await encryptWithMasterKey(userData.settings);

      // Simulate saving encrypted data
      const encryptedUserData = {
        tasks: encryptedTasks,
        notes: encryptedNotes,
        settings: encryptedSettings
      };

      // 3. Logout
      clearMasterKey();
      expect(isMasterKeyLoaded()).toBe(false);

      // Try to decrypt without key (should fail)
      await expect(decryptObject(encryptedUserData.tasks)).rejects.toThrow('Master key not loaded');

      // 4. Login
      const loginSuccess = await loadUserMasterKey(
        userRecord.encryptedMasterKey,
        userRecord.salt,
        userPassword
      );
      expect(loginSuccess).toBe(true);

      // 5. Decrypt and verify data
      const decryptedTasks = await decryptObject(encryptedUserData.tasks);
      const decryptedNotes = await decryptObject(encryptedUserData.notes);
      const decryptedSettings = await decryptObject(encryptedUserData.settings);

      expect(decryptedTasks).toEqual(userData.tasks);
      expect(decryptedNotes).toEqual(userData.notes);
      expect(decryptedSettings).toEqual(userData.settings);
    });

    it('should fail login with wrong password', async () => {
      // Registration
      const correctPassword = 'CorrectPassword123!';
      const wrongPassword = 'WrongPassword123!';

      const { encryptedMasterKey, salt } = await generateMasterKeyForUser(correctPassword);

      // Load the key to encrypt data
      await loadUserMasterKey(encryptedMasterKey, salt, correctPassword);

      // Encrypt some data
      const secretData = 'This is very secret';
      const encrypted = await encryptWithMasterKey(secretData);

      // Logout
      clearMasterKey();

      // Try to login with wrong password
      const loginSuccess = await loadUserMasterKey(encryptedMasterKey, salt, wrongPassword);
      expect(loginSuccess).toBe(false);
      expect(isMasterKeyLoaded()).toBe(false);

      // Should not be able to decrypt
      await expect(decryptString(encrypted)).rejects.toThrow('Master key not loaded');
    });
  });

  describe('Data type encryption tests', () => {
    beforeEach(async () => {
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');
    });

    it('should handle various string types', async () => {
      const testStrings = [
        'Simple string',
        'String with special chars: !@#$%^&*()',
        'Unicode: 🔐 🔑 🛡️',
        'Multi-line\nstring\nwith\nbreaks',
        'Very long string: ' + 'a'.repeat(1000),
        '', // Empty string
        '   ', // Whitespace only
        'Mixed languages: Hello Здравствуйте مرحبا 你好'
      ];

      for (const str of testStrings) {
        const encrypted = await encryptWithMasterKey(str);
        const decrypted = await decryptString(encrypted);
        expect(decrypted).toBe(str);
      }
    });

    it('should handle various object types', async () => {
      const testObjects = [
        { simple: 'object' },
        { nested: { deeply: { nested: { object: true } } } },
        { array: [1, 2, 3, 4, 5] },
        { mixed: [{ a: 1 }, { b: 2 }, [3, 4]] },
        { dates: { created: new Date().toISOString(), updated: null } },
        { empty: {} },
        { nullValue: null, undefinedValue: undefined },
        { bigNumber: 9007199254740991 }, // Max safe integer
        { boolean: true, anotherBoolean: false }
      ];

      for (const obj of testObjects) {
        const encrypted = await encryptWithMasterKey(obj);
        const decrypted = await decryptObject(encrypted);
        expect(decrypted).toEqual(obj);
      }
    });

    it('should handle large data sets', async () => {
      // Create a large array of tasks
      const largeTasks = Array.from({ length: 1000 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task number ${i}`,
        description: `This is a detailed description for task ${i}`,
        completed: i % 2 === 0,
        tags: [`tag-${i % 10}`, `tag-${i % 5}`],
        metadata: {
          created: new Date().toISOString(),
          priority: i % 3,
          assignee: `user-${i % 20}`
        }
      }));

      const encrypted = await encryptWithMasterKey(largeTasks);
      const decrypted = await decryptObject(encrypted);

      expect(decrypted).toEqual(largeTasks);
      expect(Array.isArray(decrypted)).toBe(true);
      expect(decrypted).toHaveLength(1000);
    });
  });

  describe('Key rotation scenario', () => {
    it('should support key rotation while preserving data access', async () => {
      // 1. Initial setup with first password
      const oldPassword = 'OldPassword123!';
      const { encryptedMasterKey: oldEncrypted, salt: oldSalt } =
        await generateMasterKeyForUser(oldPassword);

      await loadUserMasterKey(oldEncrypted, oldSalt, oldPassword);

      // 2. Encrypt important data
      const importantData = {
        appSettings: {
          theme: 'dark',
          language: 'en',
          dateFormat: 'YYYY-MM-DD'
        },
        workspaceData: {
          defaultListId: 'list-123',
          lastSyncTime: '2024-01-01T00:00:00Z'
        }
      };

      const encryptedData = await encryptWithMasterKey(importantData);

      // 3. User wants to change password
      // First, get the current master key
      const currentMasterKey = cryptoManager.getCurrentKey();
      expect(currentMasterKey).not.toBeNull();

      // 4. Re-encrypt master key with new password
      const newPassword = 'NewPassword456!';
      const { encryptedMasterKey: newEncrypted, salt: newSalt } =
        await cryptoManager.encryptMasterKey(currentMasterKey!, newPassword);

      // 5. Simulate logout and login with new password
      clearMasterKey();
      const loginSuccess = await loadUserMasterKey(newEncrypted, newSalt, newPassword);
      expect(loginSuccess).toBe(true);

      // 6. Verify we can still decrypt the data
      const decryptedData = await decryptObject(encryptedData);
      expect(decryptedData).toEqual(importantData);
    });
  });

  describe('Multi-device scenario', () => {
    it('should allow same encrypted data to be decrypted on different devices', async () => {
      // Device 1: Create account and encrypt data
      const password = 'SharedPassword123!';
      const device1Result = await generateMasterKeyForUser(password);

      // Load key on device 1 to encrypt data
      await loadUserMasterKey(device1Result.encryptedMasterKey, device1Result.salt, password);

      // Encrypt data on device 1
      const sharedData = {
        syncedNotes: ['Note 1', 'Note 2', 'Note 3'],
        syncedTasks: [
          { id: '1', title: 'Shared task 1' },
          { id: '2', title: 'Shared task 2' }
        ]
      };

      const encryptedSharedData = await encryptWithMasterKey(sharedData);

      // Simulate sync to server
      const serverData = {
        encryptedMasterKey: device1Result.encryptedMasterKey,
        salt: device1Result.salt,
        encryptedData: encryptedSharedData
      };

      // Device 2: Login and decrypt
      clearMasterKey(); // Simulate fresh device

      const device2Login = await loadUserMasterKey(
        serverData.encryptedMasterKey,
        serverData.salt,
        password
      );
      expect(device2Login).toBe(true);

      const device2Decrypted = await decryptObject(serverData.encryptedData);
      expect(device2Decrypted).toEqual(sharedData);
    });
  });

  describe('Error recovery scenarios', () => {
    it('should handle partial encryption failures gracefully', async () => {
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      const dataToEncrypt = [
        { id: '1', data: 'First item' },
        { id: '2', data: 'Second item' },
        { id: '3', data: 'Third item' }
      ];

      const encryptedItems: string[] = [];
      const failedItems: string[] = [];

      // Encrypt items individually
      for (const item of dataToEncrypt) {
        try {
          const encrypted = await encryptWithMasterKey(item);
          encryptedItems.push(encrypted);
        } catch (error) {
          failedItems.push(item.id);
        }
      }

      // All should succeed in normal conditions
      expect(encryptedItems).toHaveLength(3);
      expect(failedItems).toHaveLength(0);

      // Verify all can be decrypted
      for (const encrypted of encryptedItems) {
        const decrypted = await decryptObject(encrypted);
        expect(decrypted).toBeDefined();
      }
    });

    it('should handle corrupted encrypted data gracefully', async () => {
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      const originalData = 'Important data';
      const encrypted = await encryptWithMasterKey(originalData);

      // Corrupt the encrypted data
      const corruptedData = encrypted.slice(0, -5) + 'xxxxx';

      // Should throw when trying to decrypt corrupted data
      await expect(decryptString(corruptedData)).rejects.toThrow();

      // Original encrypted data should still work
      const decrypted = await decryptString(encrypted);
      expect(decrypted).toBe(originalData);
    });
  });

  describe('Performance considerations', () => {
    it('should handle rapid encryption/decryption operations', async () => {
      const { encryptedMasterKey, salt } = await generateMasterKeyForUser('password');
      await loadUserMasterKey(encryptedMasterKey, salt, 'password');

      const startTime = Date.now();
      const operations = 100;

      // Perform many encryption/decryption operations
      const promises = [];
      for (let i = 0; i < operations; i++) {
        const data = `Test data ${i}`;
        promises.push(encryptWithMasterKey(data).then((encrypted) => decryptString(encrypted)));
      }

      const results = await Promise.all(promises);
      const endTime = Date.now();

      // Verify all operations succeeded
      expect(results).toHaveLength(operations);
      results.forEach((result, index) => {
        expect(result).toBe(`Test data ${index}`);
      });

      // Should complete reasonably quickly (less than 5 seconds for 100 operations)
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });
});
