/**
 * Basic cryptographic functions for E2E encryption
 * This module provides core cryptographic operations for the application
 */

import { createLogger } from '@reborn/utils';

const logger = createLogger('Encryption');

/**
 * Generates a random salt for key derivation
 * @param length Length of the salt in bytes (default: 32)
 * @returns Uint8Array containing random bytes
 */
export async function generateSalt(length = 32): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Generates a random initialization vector (IV) for encryption
 * @param length Length of the IV in bytes (default: 12 for AES-GCM)
 * @returns Uint8Array containing random bytes
 */
export async function generateIV(length = 12): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Derives a key from a password using PBKDF2
 * Used for master key wrapping — PBKDF2 600K iterations.
 * (Web Crypto API does not support Argon2id in deriveKey())
 * @param password The user's password
 * @param salt Salt for key derivation
 * @param iterations Number of iterations for PBKDF2 (default: 600000)
 * @param keyLength Length of the derived key in bits (default: 256)
 * @param extractable Whether the derived key can be exported (default: false)
 * @returns CryptoKey object for use in encryption/decryption
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  iterations = 600000,
  keyLength = 256,
  extractable = false
): Promise<CryptoKey> {
  try {
    // Convert password to a buffer
    const passwordBuffer = new TextEncoder().encode(password);

    // Import the password as a raw key
    const baseKey = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    // Derive the key using PBKDF2
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: keyLength },
      extractable,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    logger.error('Error deriving key from password', error);
    throw new Error('Failed to derive key from password', { cause: error });
  }
}

/**
 * Encrypts data using AES-GCM
 * @param data Data to encrypt (string or object)
 * @param key CryptoKey to use for encryption
 * @param iv Initialization vector (if not provided, a new one will be generated)
 * @returns Object containing the encrypted data and IV
 */
export async function encryptData(
  data: string | object | Uint8Array,
  key: CryptoKey,
  iv?: Uint8Array
): Promise<{
  encryptedData: Uint8Array;
  iv: Uint8Array;
}> {
  try {
    // Handle different data types
    let dataBuffer: Uint8Array;

    if (data instanceof Uint8Array) {
      // Direct use of Uint8Array (e.g., for raw key data)
      dataBuffer = data;
    } else if (typeof data === 'string') {
      // Convert string to buffer
      dataBuffer = new TextEncoder().encode(data);
    } else {
      // Convert object to JSON string, then to buffer
      const dataString = JSON.stringify(data);
      dataBuffer = new TextEncoder().encode(dataString);
    }

    // Generate IV if not provided
    const ivToUse = iv || (await generateIV());

    // Encrypt the data
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: ivToUse.buffer as ArrayBuffer,
        tagLength: 128 // Authentication tag length
      },
      key,
      dataBuffer.buffer as ArrayBuffer
    );

    return {
      encryptedData: new Uint8Array(encryptedBuffer),
      iv: ivToUse
    };
  } catch (error) {
    logger.error('Error encrypting data', error);
    throw new Error('Failed to encrypt data', { cause: error });
  }
}

/**
 * Decrypts data using AES-GCM
 * @param encryptedData Encrypted data as Uint8Array
 * @param key CryptoKey to use for decryption
 * @param iv Initialization vector used for encryption
 * @param returnType Type of return value: 'string', 'uint8array', or 'object' (default: 'string')
 * @returns Decrypted data as string, Uint8Array or parsed object
 */
export async function decryptData<T = string>(
  encryptedData: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
  returnType: 'string' | 'uint8array' | 'object' | boolean = 'string'
): Promise<T | string | Uint8Array> {
  try {
    // Decrypt the data
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
        tagLength: 128 // Authentication tag length
      },
      key,
      encryptedData.buffer as ArrayBuffer
    );

    // Handle boolean parameter for backward compatibility
    const effectiveReturnType =
      typeof returnType === 'boolean' ? (returnType ? 'object' : 'string') : returnType;

    // Return as Uint8Array if requested
    if (effectiveReturnType === 'uint8array') {
      return new Uint8Array(decryptedBuffer);
    }

    // Convert buffer to string
    const decryptedString = new TextDecoder().decode(decryptedBuffer);

    // Parse as JSON if requested
    if (effectiveReturnType === 'object') {
      try {
        return JSON.parse(decryptedString) as T;
      } catch (e) {
        logger.error('Error parsing decrypted data as JSON', e);
        throw new Error('Failed to parse decrypted data as JSON', { cause: e });
      }
    }

    return decryptedString as unknown as T;
  } catch (error) {
    logger.error('Error decrypting data', error);
    throw new Error('Failed to decrypt data', { cause: error });
  }
}

/**
 * Converts a Uint8Array to a Base64 string
 * @param buffer Uint8Array to convert
 * @param urlSafe Whether to use base64url encoding (default: false)
 * @returns Base64 string
 */
export function arrayBufferToBase64(buffer: Uint8Array, urlSafe = false): string {
  // Używamy bardziej niezawodnej metody dla większych tablic
  // aby uniknąć problemów z limitem rozmiaru stosu
  let binary = '';
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  let base64 = btoa(binary);

  // Konwertuj na base64url jeśli wymagane
  if (urlSafe) {
    base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  return base64;
}

/**
 * Converts a Base64 string to a Uint8Array
 * Supports both standard base64 and base64url encoding
 * @param base64 Base64 or base64url string to convert
 * @returns Uint8Array
 */
export function base64ToArrayBuffer(base64: string): Uint8Array {
  try {
    // Sprawdź czy string jest prawidłowym base64
    if (typeof base64 !== 'string') {
      throw new Error('Invalid input: expected a string');
    }

    // Handle empty string - return empty Uint8Array
    if (base64 === '') {
      return new Uint8Array(0);
    }

    // Usuń białe znaki które mogą powodować problemy
    let cleanBase64 = base64.trim();

    // Konwertuj base64url na standardowy base64
    // base64url używa - zamiast + oraz _ zamiast /
    // i nie ma paddingu =
    cleanBase64 = cleanBase64.replace(/-/g, '+').replace(/_/g, '/');

    // Dodaj padding jeśli potrzebny
    const padding = cleanBase64.length % 4;
    if (padding) {
      if (padding === 2) {
        cleanBase64 += '==';
      } else if (padding === 3) {
        cleanBase64 += '=';
      } else {
        throw new Error('Invalid base64 string length');
      }
    }

    // Dekoduj base64
    const binaryString = atob(cleanBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    // Deliberately not logging the input itself: it is ciphertext (or a
    // corrupted stand-in for one), and "never log ciphertext" is cheaper to
    // enforce than to reason about per call-site (audit 013 O53).
    logger.error('Failed to convert base64 to ArrayBuffer:', error);
    throw new Error(
      `Failed to decode base64 string: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

/**
 * Exports a CryptoKey to raw format
 * @param key CryptoKey to export
 * @returns Uint8Array containing the raw key
 */
export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  try {
    const rawKey = await crypto.subtle.exportKey('raw', key);
    return new Uint8Array(rawKey);
  } catch (error) {
    logger.error('Error exporting key', error);
    throw new Error('Failed to export key', { cause: error });
  }
}

/**
 * Imports a raw key
 * @param keyData Raw key data as Uint8Array
 * @param algorithm Algorithm to use for the key
 * @param usages Key usages
 * @param extractable Whether the key can be exported (default: false)
 * @returns CryptoKey object
 */
export async function importKey(
  keyData: Uint8Array,
  algorithm: AlgorithmIdentifier = 'AES-GCM',
  usages: KeyUsage[] = ['encrypt', 'decrypt'],
  extractable = false
): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      'raw',
      keyData.buffer as ArrayBuffer,
      algorithm,
      extractable,
      usages
    );
  } catch (error) {
    logger.error('Error importing key', error);
    throw new Error('Failed to import key', { cause: error });
  }
}
