import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSalt,
  generateIV,
  deriveKeyFromPassword,
  encryptData,
  decryptData,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  exportKey,
  importKey
} from '../encryption';

describe('Base64 conversion', () => {
  it('should convert Uint8Array to base64 and back', () => {
    // Test with different sizes of data
    const testData = [
      new Uint8Array([1, 2, 3, 4, 5]),
      new Uint8Array([255, 128, 64, 32, 16, 8, 4, 2, 1]),
      new Uint8Array(Array.from({ length: 256 }, (_, i) => i))
    ];

    testData.forEach(original => {
      const base64 = arrayBufferToBase64(original);
      const restored = base64ToArrayBuffer(base64);
      
      expect(restored).toEqual(original);
    });
  });

  it('should handle base64url format', () => {
    const original = new Uint8Array([255, 239, 191]);
    
    // Standard base64
    const standardBase64 = arrayBufferToBase64(original, false);
    expect(standardBase64).toContain('+'); // Should contain + or / or =
    
    // Base64url
    const base64url = arrayBufferToBase64(original, true);
    expect(base64url).not.toContain('+');
    expect(base64url).not.toContain('/');
    expect(base64url).not.toContain('=');
    
    // Both should decode to the same value
    const restoredStandard = base64ToArrayBuffer(standardBase64);
    const restoredUrl = base64ToArrayBuffer(base64url);
    
    expect(restoredStandard).toEqual(original);
    expect(restoredUrl).toEqual(original);
  });

  it('should handle empty input', () => {
    const empty = new Uint8Array(0);
    const base64 = arrayBufferToBase64(empty);
    const restored = base64ToArrayBuffer(base64);
    
    expect(restored).toEqual(empty);
  });

  it('should throw error for invalid base64 input', () => {
    expect(() => base64ToArrayBuffer('invalid!@#$')).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => base64ToArrayBuffer(null)).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => base64ToArrayBuffer(undefined)).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => base64ToArrayBuffer(123)).toThrow();
  });
});

describe('generateSalt', () => {
  it('should generate a random salt of default length (32 bytes)', async () => {
    const salt = await generateSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(32);
  });

  it('should generate a salt of custom length', async () => {
    const salt = await generateSalt(16);
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(16);
  });

  it('should generate different salts each time', async () => {
    const salt1 = await generateSalt();
    const salt2 = await generateSalt();
    expect(salt1).not.toEqual(salt2);
  });
});

describe('generateIV', () => {
  it('should generate a random IV of default length', async () => {
    const iv = await generateIV();
    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(12);
  });

  it('should generate an IV of custom length', async () => {
    const iv = await generateIV(16);
    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(16);
  });

  it('should generate different IVs each time', async () => {
    const iv1 = await generateIV();
    const iv2 = await generateIV();
    expect(iv1).not.toEqual(iv2);
  });
});

describe('deriveKeyFromPassword', () => {
  let salt: Uint8Array;

  beforeEach(async () => {
    salt = await generateSalt();
  });

  it('should derive a key from password', async () => {
    const password = 'mySecurePassword123!';
    const key = await deriveKeyFromPassword(password, salt);
    
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
    expect(key.extractable).toBe(false);
  });

  it('should derive same key for same password and salt', async () => {
    const password = 'mySecurePassword123!';
    const key1 = await deriveKeyFromPassword(password, salt, 600000, 256, true);
    const key2 = await deriveKeyFromPassword(password, salt, 600000, 256, true);
    
    // Export keys to compare
    const exportedKey1 = await exportKey(key1);
    const exportedKey2 = await exportKey(key2);
    
    expect(exportedKey1).toEqual(exportedKey2);
  });

  it('should derive different keys for different passwords', async () => {
    const password1 = 'password1';
    const password2 = 'password2';
    const key1 = await deriveKeyFromPassword(password1, salt, 600000, 256, true);
    const key2 = await deriveKeyFromPassword(password2, salt, 600000, 256, true);
    
    const exportedKey1 = await exportKey(key1);
    const exportedKey2 = await exportKey(key2);
    
    expect(exportedKey1).not.toEqual(exportedKey2);
  });

  it('should derive different keys for different salts', async () => {
    const password = 'myPassword';
    const salt2 = await generateSalt();
    const key1 = await deriveKeyFromPassword(password, salt, 600000, 256, true);
    const key2 = await deriveKeyFromPassword(password, salt2, 600000, 256, true);
    
    const exportedKey1 = await exportKey(key1);
    const exportedKey2 = await exportKey(key2);
    
    expect(exportedKey1).not.toEqual(exportedKey2);
  });

  it('should default to non-extractable', async () => {
    const password = 'testPassword';
    const key = await deriveKeyFromPassword(password, salt);
    expect(key.extractable).toBe(false);
    
    // Attempting to export should throw
    await expect(exportKey(key)).rejects.toThrow();
  });

  it('should support extractable flag', async () => {
    const password = 'testPassword';
    const key = await deriveKeyFromPassword(password, salt, 600000, 256, true);
    expect(key.extractable).toBe(true);
    
    const exported = await exportKey(key);
    expect(exported).toBeInstanceOf(Uint8Array);
  });
});

describe('encryptData and decryptData', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    const salt = await generateSalt();
    key = await deriveKeyFromPassword('testPassword', salt);
  });

  describe('string encryption/decryption', () => {
    it('should encrypt and decrypt string data', async () => {
      const plaintext = 'Hello, World! This is a secret message.';
      const { encryptedData, iv } = await encryptData(plaintext, key);
      
      expect(encryptedData).toBeInstanceOf(Uint8Array);
      expect(iv).toBeInstanceOf(Uint8Array);
      expect(iv.length).toBe(12);
      
      const decrypted = await decryptData(encryptedData, key, iv);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty strings', async () => {
      const plaintext = '';
      const { encryptedData, iv } = await encryptData(plaintext, key);
      const decrypted = await decryptData(encryptedData, key, iv);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode strings', async () => {
      const plaintext = '🔐 Unicode test: ąćęłńóśźż 中文 العربية';
      const { encryptedData, iv } = await encryptData(plaintext, key);
      const decrypted = await decryptData(encryptedData, key, iv);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('object encryption/decryption', () => {
    it('should encrypt and decrypt objects', async () => {
      const plainObj = {
        name: 'Test User',
        age: 30,
        tasks: ['Task 1', 'Task 2'],
        metadata: { created: new Date().toISOString() }
      };
      
      const { encryptedData, iv } = await encryptData(plainObj, key);
      const decrypted = await decryptData(encryptedData, key, iv, 'object');
      
      expect(decrypted).toEqual(plainObj);
    });

    it('should handle nested objects', async () => {
      const complexObj = {
        level1: {
          level2: {
            level3: {
              data: 'deeply nested'
            }
          }
        },
        array: [1, 2, { nested: true }]
      };
      
      const { encryptedData, iv } = await encryptData(complexObj, key);
      const decrypted = await decryptData(encryptedData, key, iv, 'object');
      
      expect(decrypted).toEqual(complexObj);
    });
  });

  describe('Uint8Array encryption/decryption', () => {
    it('should encrypt and decrypt Uint8Array data', async () => {
      const plainData = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 0]);
      const { encryptedData, iv } = await encryptData(plainData, key);
      
      const decrypted = await decryptData(encryptedData, key, iv, 'uint8array');
      expect(decrypted).toBeInstanceOf(Uint8Array);
      expect(decrypted).toEqual(plainData);
    });
  });

  describe('encryption with custom IV', () => {
    it('should use provided IV for encryption', async () => {
      const plaintext = 'Test with custom IV';
      const customIV = await generateIV();
      
      const { encryptedData, iv } = await encryptData(plaintext, key, customIV);
      expect(iv).toEqual(customIV);
      
      const decrypted = await decryptData(encryptedData, key, iv);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('error handling', () => {
    it('should fail to decrypt with wrong key', async () => {
      const plaintext = 'Secret data';
      const { encryptedData, iv } = await encryptData(plaintext, key);
      
      // Create a different key
      const wrongSalt = await generateSalt();
      const wrongKey = await deriveKeyFromPassword('differentPassword', wrongSalt);
      
      await expect(
        decryptData(encryptedData, wrongKey, iv)
      ).rejects.toThrow('Failed to decrypt data');
    });

    it('should fail to decrypt with wrong IV', async () => {
      const plaintext = 'Secret data';
      const { encryptedData } = await encryptData(plaintext, key);
      const wrongIV = await generateIV();
      
      await expect(
        decryptData(encryptedData, key, wrongIV)
      ).rejects.toThrow('Failed to decrypt data');
    });

    it('should fail to decrypt corrupted data', async () => {
      const plaintext = 'Secret data';
      const { encryptedData, iv } = await encryptData(plaintext, key);
      
      // Corrupt the encrypted data
      encryptedData[0] = encryptedData[0] ^ 0xFF;
      
      await expect(
        decryptData(encryptedData, key, iv)
      ).rejects.toThrow('Failed to decrypt data');
    });
  });

  describe('backward compatibility', () => {
    it('should handle boolean returnType parameter', async () => {
      const plainObj = { test: 'data' };
      const { encryptedData, iv } = await encryptData(plainObj, key);
      
      // Test with boolean true (should return object)
      const decryptedObj = await decryptData(encryptedData, key, iv, true);
      expect(decryptedObj).toEqual(plainObj);
      
      // Test with boolean false (should return string)
      const decryptedStr = await decryptData(encryptedData, key, iv, false);
      expect(decryptedStr).toBe(JSON.stringify(plainObj));
    });
  });
});

describe('exportKey and importKey', () => {
  it('should export and import a key', async () => {
    const salt = await generateSalt();
    const originalKey = await deriveKeyFromPassword('testPassword', salt, 600000, 256, true);
    
    // Export the key
    const exportedKey = await exportKey(originalKey);
    expect(exportedKey).toBeInstanceOf(Uint8Array);
    expect(exportedKey.length).toBe(32); // 256 bits = 32 bytes
    
    // Import the key back
    const importedKey = await importKey(exportedKey);
    expect(importedKey).toBeDefined();
    expect(importedKey.type).toBe('secret');
    expect(importedKey.algorithm.name).toBe('AES-GCM');
    expect(importedKey.usages).toContain('encrypt');
    expect(importedKey.usages).toContain('decrypt');
    expect(importedKey.extractable).toBe(false); // default non-extractable
    
    // Test that the imported key works
    const testData = 'Test encryption with imported key';
    const { encryptedData, iv } = await encryptData(testData, importedKey);
    const decrypted = await decryptData(encryptedData, importedKey, iv);
    expect(decrypted).toBe(testData);
  });

  it('should import key with extractable flag', async () => {
    const keyData = crypto.getRandomValues(new Uint8Array(32));
    const key = await importKey(keyData, 'AES-GCM', ['encrypt', 'decrypt'], true);
    expect(key.extractable).toBe(true);
    
    const exported = await exportKey(key);
    expect(exported).toBeInstanceOf(Uint8Array);
  });

  it('should import key with custom algorithm and usages', async () => {
    const keyData = crypto.getRandomValues(new Uint8Array(32));
    
    const key = await importKey(
      keyData,
      { name: 'AES-GCM' },
      ['encrypt', 'decrypt']
    );
    
    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.usages).toEqual(['encrypt', 'decrypt']);
    expect(key.extractable).toBe(false);
  });

  it('should handle key export/import errors gracefully', async () => {
    // Create a non-extractable key (this will fail in our test environment)
    const keyData = crypto.getRandomValues(new Uint8Array(32));
    const nonExtractableKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false, // non-extractable
      ['encrypt', 'decrypt']
    );
    
    // Export should fail for non-extractable key
    await expect(exportKey(nonExtractableKey)).rejects.toThrow('Failed to export key');
  });
});
