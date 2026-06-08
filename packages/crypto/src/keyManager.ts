/**
 * Key Manager
 *
 * This module provides functions for managing cryptographic keys,
 * including generation, storage, and retrieval.
 */

import { cryptoManager } from './cryptoManager';
import { createLogger } from '@reborn/utils';

const logger = createLogger('KeyManager');

/**
 * Generate a new master key for a user during registration
 * @param password User's password
 * @returns Encrypted master key and salt for storage in the database
 */
export async function generateMasterKeyForUser(password: string): Promise<{
  encryptedMasterKey: string;
  salt: string;
}> {
  try {
    logger.debug('Generating new master key for user');

    // Generate a new master key
    const masterKey = await cryptoManager.generateMasterKey();

    // Encrypt the master key with the user's password
    const result = await cryptoManager.encryptMasterKey(masterKey, password);

    logger.debug('Master key generated and encrypted successfully');
    return result;
  } catch (error) {
    logger.error('Failed to generate master key for user', error);
    throw new Error('Failed to generate master key', { cause: error });
  }
}

/**
 * Load and decrypt a user's master key during login
 * @param encryptedMasterKey Encrypted master key from the database
 * @param salt Salt used for key derivation
 * @param password User's password
 * @returns True if the key was successfully loaded, false otherwise
 */
export async function loadUserMasterKey(
  encryptedMasterKey: string,
  salt: string,
  password: string
): Promise<boolean> {
  try {
    logger.debug('Loading user master key');

    if (!encryptedMasterKey || !salt) {
      logger.error('Missing encrypted master key or salt');
      return false;
    }

    // Decrypt the master key
    const masterKey = await cryptoManager.decryptMasterKey(encryptedMasterKey, salt, password);

    // Set the master key in the CryptoManager
    await cryptoManager.setMasterKey(masterKey);

    // Verify that the key was actually loaded
    const isLoaded = cryptoManager.isInitialized();

    if (!isLoaded) {
      logger.error('Master key was set but initialization failed');
      return false;
    }

    // Weryfikacja klucza
    try {
      await cryptoManager.verifyEncryption();
      logger.debug('Key successfully verified after loading');
    } catch (verifyError) {
      logger.error('Failed to verify encryption functionality with loaded key', verifyError);
      return false;
    }

    logger.info('User master key loaded and verified successfully');
    return true;
  } catch (error) {
    logger.error('Failed to load user master key', error);
    return false;
  }
}

/**
 * Clear the master key from memory during logout
 */
export function clearMasterKey(): void {
  logger.debug('Clearing master key from memory');
  cryptoManager.clearMasterKey();
}

/**
 * Check if a master key is currently loaded
 * @returns True if a master key is loaded, false otherwise
 */
export function isMasterKeyLoaded(): boolean {
  return cryptoManager.isInitialized();
}

/**
 * Check if a master key has been verified
 * @returns True if the master key has been verified, false otherwise
 */
export function isKeyVerified(): boolean {
  return cryptoManager.isKeyVerified();
}

/**
 * Check if a key restore has been attempted
 * @returns True if there was an attempt to restore the key, false otherwise
 */
export function wasKeyRestoreAttempted(): boolean {
  return cryptoManager.wasKeyRestoreAttempted();
}

/**
 * Verify the current master key
 * @returns True if verification successful, false otherwise
 */
export async function verifyMasterKey(): Promise<boolean> {
  if (!isMasterKeyLoaded()) {
    logger.warn('Cannot verify key - not loaded');
    return false;
  }

  try {
    const result = await cryptoManager.verifyEncryption();
    logger.debug('Master key verification result:', result);
    return result;
  } catch (error) {
    logger.error('Master key verification failed:', error);

    // Jeśli weryfikacja się nie powiodła, wyczyść klucz,
    // aby uniknąć dalszego używania uszkodzonego klucza
    logger.warn('Clearing potentially corrupted master key');
    cryptoManager.clearMasterKey();

    return false;
  }
}

/**
 * Encrypt data with the current master key
 * @param data String or object to encrypt
 * @returns Encrypted data in the format "iv:encryptedData"
 */
export async function encryptWithMasterKey(data: string | object): Promise<string> {
  if (!isMasterKeyLoaded()) {
    throw new Error('Master key not loaded');
  }

  if (typeof data === 'string') {
    return cryptoManager.encryptString(data);
  } else {
    return cryptoManager.encryptObject(data);
  }
}

/**
 * Decrypt a string with the current master key
 * @param encryptedData Encrypted data in the format "iv:encryptedData"
 * @returns Decrypted string
 */
export async function decryptString(encryptedData: string): Promise<string> {
  if (!isMasterKeyLoaded()) {
    throw new Error('Master key not loaded');
  }

  return cryptoManager.decryptString(encryptedData);
}

/**
 * Decrypt an object with the current master key
 * @param encryptedData Encrypted data in the format "iv:encryptedData"
 * @returns Decrypted object
 */
export async function decryptObject<T>(encryptedData: string): Promise<T> {
  if (!isMasterKeyLoaded()) {
    throw new Error('Master key not loaded');
  }

  return cryptoManager.decryptObject<T>(encryptedData);
}
