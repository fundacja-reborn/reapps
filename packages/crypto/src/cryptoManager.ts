/**
 * CryptoManager
 *
 * This class manages cryptographic operations for the application,
 * including key generation, encryption, and decryption.
 */

import {
  deriveKeyFromPassword,
  encryptData,
  decryptData,
  generateSalt,
  generateIV,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  exportKey,
  importKey
} from './encryption';
import { assertEncrypted } from './encryption-validation';
import { createLogger } from '@reborn/utils';

const logger = createLogger('CryptoManager');

/**
 * Cross-app key event broadcast.
 *
 * Both reborn-task and reborn-notes share origin (and therefore IndexedDB).
 * After one app calls `setMasterKey()` / `clearMasterKey()`, the other app —
 * if already open — has no way to discover the change without polling. The
 * BroadcastChannel `reborn_e2e` lets the crypto layer notify all peers on
 * the same origin; subscribers (auth stores, layout guards) react by flipping
 * `hasE2E` and redirecting away from `/auth/unlock` without a second password
 * prompt. The key itself stays in IndexedDB — we never put plaintext on the
 * wire and never leak it across origins.
 */
const KEY_EVENT_CHANNEL = 'reborn_e2e';

export type CryptoKeyEvent = 'unlocked' | 'cleared';

export type KeyEventHandler = (event: CryptoKeyEvent) => void;

export class CryptoManager {
  private static instance: CryptoManager;
  private masterKey: CryptoKey | null = null;
  private initialized = false;
  private readonly TEMP_KEY_STORAGE_KEY = 'TEMP_MASTER_KEY_EXPORT';
  private readonly CRYPTO_VERIFIED_KEY = 'CRYPTO_VERIFICATION_SUCCESS';
  private readonly IDB_NAME = 'reborn_crypto_keys';
  private readonly IDB_STORE = 'master_key';
  private readonly IDB_KEY_ID = 'current';
  private restoreKeyAttempted = false;
  private restorePromise: Promise<boolean> | null = null;

  // Cross-app key event channel — single instance with a fanout list of
  // subscribers so HMR re-subscribing doesn't allocate extra channels.
  private channel: BroadcastChannel | null = null;
  private channelInitialized = false;
  private keyEventHandlers: Set<KeyEventHandler> = new Set();

  // Private constructor for singleton pattern
  private constructor() {
    // Lazy init: restorePromise is created but not awaited in constructor
    this.restorePromise = this.restoreKeyOnStartup();
  }

  /**
   * Orchestrates key restoration on startup.
   * Priority: IndexedDB (persistent) → sessionStorage (fallback) → null.
   */
  private async restoreKeyOnStartup(): Promise<boolean> {
    try {
      // 1. Try IndexedDB first (survives tab close / PWA restart)
      if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
        const idbKey = await this.restoreKeyFromIDB();
        if (idbKey) {
          this.masterKey = idbKey;
          this.initialized = true;
          this.restoreKeyAttempted = true;
          logger.info('Successfully restored master key from IndexedDB');
          try {
            await this.verifyEncryption();
            logger.info('IndexedDB-restored key passed verification');
            return true;
          } catch (verifyError) {
            logger.error('IndexedDB-restored key failed verification:', verifyError);
            this.masterKey = null;
            this.initialized = false;
            await this.clearKeyFromIDB();
          }
        }
      }

      // 2. Fallback: sessionStorage (same-session navigation)
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const savedKey = window.sessionStorage.getItem(this.TEMP_KEY_STORAGE_KEY);
        if (savedKey) {
          logger.debug('Found saved master key in session storage, attempting restore');
          const result = await this.restoreKeyFromSessionStorage(savedKey);
          this.restoreKeyAttempted = true;
          return result;
        }
      }

      this.restoreKeyAttempted = true;
      return false;
    } catch (error) {
      logger.error('Key restore on startup failed:', error);
      this.restoreKeyAttempted = true;
      return false;
    }
  }

  // ── IndexedDB persistence ────────────────────────────────────

  /** Timeout (ms) for IndexedDB open — prevents hanging on locked/corrupted DB. */
  private readonly IDB_TIMEOUT_MS = 5_000;

  private openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('IndexedDB open timed out'));
      }, this.IDB_TIMEOUT_MS);

      const request = indexedDB.open(this.IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.IDB_STORE)) {
          db.createObjectStore(this.IDB_STORE);
        }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error);
      };
    });
  }

  private async persistKeyToIDB(): Promise<void> {
    if (typeof indexedDB === 'undefined' || !this.masterKey) return;
    try {
      const db = await this.openIDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.IDB_STORE, 'readwrite');
        tx.objectStore(this.IDB_STORE).put(this.masterKey, this.IDB_KEY_ID);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      logger.debug('Master key persisted to IndexedDB');
    } catch (error) {
      logger.error('Failed to persist master key to IndexedDB:', error);
    }
  }

  private async restoreKeyFromIDB(): Promise<CryptoKey | null> {
    if (typeof indexedDB === 'undefined') return null;
    try {
      const db = await this.openIDB();
      const key = await new Promise<CryptoKey | null>((resolve, reject) => {
        const tx = db.transaction(this.IDB_STORE, 'readonly');
        const req = tx.objectStore(this.IDB_STORE).get(this.IDB_KEY_ID);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return key;
    } catch (error) {
      logger.warn('Failed to restore master key from IndexedDB:', error);
      return null;
    }
  }

  private async clearKeyFromIDB(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await this.openIDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.IDB_STORE, 'readwrite');
        tx.objectStore(this.IDB_STORE).delete(this.IDB_KEY_ID);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      logger.debug('Master key cleared from IndexedDB');
    } catch (error) {
      logger.error('Failed to clear master key from IndexedDB:', error);
    }
  }

  /**
   * Restore key from sessionStorage — fallback for same-session navigation.
   */
  private async restoreKeyFromSessionStorage(savedKey: string): Promise<boolean> {
    try {
      const rawKey = base64ToArrayBuffer(savedKey);
      const key = await importKey(rawKey, 'AES-GCM', ['encrypt', 'decrypt'], true);
      this.masterKey = key;
      this.initialized = true;
      logger.info('Successfully restored master key from session storage');

      try {
        await this.verifyEncryption();
        logger.info('Session-storage-restored key passed verification');
        // Persist to IndexedDB so it survives tab close
        await this.persistKeyToIDB();
      } catch (verifyError) {
        logger.error('Session-storage-restored key failed verification:', verifyError);
        this.masterKey = null;
        this.initialized = false;
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem(this.TEMP_KEY_STORAGE_KEY);
          window.sessionStorage.removeItem(this.CRYPTO_VERIFIED_KEY);
        }
        return false;
      }
      return true;
    } catch (error) {
      logger.error('Failed to restore master key from session storage:', error);
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(this.TEMP_KEY_STORAGE_KEY);
        window.sessionStorage.removeItem(this.CRYPTO_VERIFIED_KEY);
      }
      this.masterKey = null;
      this.initialized = false;
      return false;
    }
  }

  /** Timeout (ms) for waitForRestore — prevents layout from hanging on slow IDB. */
  private readonly RESTORE_TIMEOUT_MS = 5_000;

  /**
   * Wait for key restore to complete.
   * Use in auth guards to ensure restore has finished before checking isInitialized().
   * Returns false on timeout so the app can still render (user will see unlock screen).
   * @returns true if a key was successfully restored, false otherwise
   */
  public async waitForRestore(): Promise<boolean> {
    if (!this.restorePromise) return false;

    // Clear the timer the moment the restore promise wins the race — otherwise
    // the setTimeout callback still fires (with its `resolve(false)` ignored)
    // and emits a spurious "timed out" warning even when restore finished in
    // milliseconds. waitForRestore is called from multiple places per cold
    // start, so an unguarded timer produces one bogus warning per caller.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.restorePromise,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => {
            logger.warn('waitForRestore timed out — proceeding without key');
            resolve(false);
          }, this.RESTORE_TIMEOUT_MS);
        })
      ]);
    } catch {
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // ── Cross-app key events (BroadcastChannel) ──────────────────

  /**
   * Lazily create the BroadcastChannel and wire its listener. Called once on
   * first emit/subscribe. Some sandboxed environments (older iOS PWA, hardened
   * browser modes) throw when constructing BroadcastChannel — we degrade
   * silently so the rest of crypto keeps working (fast-path on /auth/unlock
   * still covers cold-start scenarios; only S3 — warm cross-app unlock —
   * regresses to the previous behaviour).
   */
  private ensureChannel(): void {
    if (this.channelInitialized) return;
    this.channelInitialized = true;
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    try {
      this.channel = new BroadcastChannel(KEY_EVENT_CHANNEL);
      this.channel.onmessage = (e: MessageEvent) => {
        const data = e.data as { type?: CryptoKeyEvent } | null;
        if (!data || (data.type !== 'unlocked' && data.type !== 'cleared')) return;
        for (const handler of this.keyEventHandlers) {
          try {
            handler(data.type);
          } catch (err) {
            logger.error('Key event handler threw:', err);
          }
        }
      };
    } catch (error) {
      logger.warn('BroadcastChannel unavailable — cross-app key events disabled:', error);
      this.channel = null;
    }
  }

  /**
   * Emit a key event to peer apps on the same origin. Fire-and-forget —
   * failure to broadcast must not break the local set/clear operation.
   */
  private postKeyEvent(type: CryptoKeyEvent): void {
    this.ensureChannel();
    if (!this.channel) return;
    try {
      this.channel.postMessage({ type });
    } catch (error) {
      logger.warn(`Failed to broadcast key event "${type}":`, error);
    }
  }

  /**
   * Subscribe to cross-app key events. Returns an unsubscriber.
   *
   * Usage: the peer app's auth store calls this once during initialization
   * and reacts to `unlocked` (flip hasE2E, redirect away from /auth/unlock)
   * and `cleared` (defense-in-depth — main logout path is the storage event
   * on `reborn_auth_credentials`).
   *
   * BroadcastChannel only delivers messages to *other* contexts on the same
   * origin, so the emitting tab does not receive its own events.
   */
  public subscribeToKeyEvents(handler: KeyEventHandler): () => void {
    this.ensureChannel();
    this.keyEventHandlers.add(handler);
    return () => {
      this.keyEventHandlers.delete(handler);
    };
  }

  /**
   * Get the singleton instance of CryptoManager
   */
  public static getInstance(): CryptoManager {
    if (!CryptoManager.instance) {
      CryptoManager.instance = new CryptoManager();
    }
    return CryptoManager.instance;
  }

  /**
   * Check if the CryptoManager is initialized with a master key
   */
  public isInitialized(): boolean {
    return this.initialized && this.masterKey !== null;
  }

  /**
   * Checks if the key restoration has been attempted
   */
  public wasKeyRestoreAttempted(): boolean {
    return this.restoreKeyAttempted;
  }

  /**
   * Check if the key has been verified
   */
  public isKeyVerified(): boolean {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    return window.sessionStorage.getItem(this.CRYPTO_VERIFIED_KEY) === 'true';
  }

  /**
   * Verify that the current key works for encryption/decryption
   */
  public async verifyEncryption(): Promise<boolean> {
    if (!this.isInitialized()) {
      throw new Error('Cannot verify encryption without initialized key');
    }

    try {
      const testValue = `test-verify-${Date.now()}`;
      const testEncrypted = await this.encryptText(testValue);

      // POPRAWKA: Sprawdź, czy wartość zaszyfrowana jest różna od oryginalnej
      // To potwierdza, że szyfrowanie rzeczywiście działa
      if (testEncrypted === testValue) {
        logger.error('Encryption verification failed - encryption did not change the value');
        throw new Error(
          'Encryption test failed: encrypted value matches original (no encryption occurred)'
        );
      }

      const testDecrypted = await this.decryptText(testEncrypted);

      const verified = testDecrypted === testValue;

      if (verified) {
        // Zapisz status weryfikacji w sessionStorage
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem(this.CRYPTO_VERIFIED_KEY, 'true');
        }
        logger.debug('Encryption verification successful');
      } else {
        logger.error("Encryption verification failed - values don't match");
        throw new Error('Encryption test failed: decrypted value does not match original');
      }

      return verified;
    } catch (error) {
      logger.error('Error during encryption verification:', error);

      // Oznacz weryfikację jako nieudaną
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(this.CRYPTO_VERIFIED_KEY);
      }

      throw new Error('Encryption verification failed');
    }
  }

  /**
   * Generate a new master key
   * Master key is extractable because it needs to be exported for password-wrapping.
   * @returns The generated master key
   */
  public async generateMasterKey(): Promise<CryptoKey> {
    try {
      const keyData = crypto.getRandomValues(new Uint8Array(32)); // 256 bits
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'AES-GCM' },
        true, // extractable — master key must be exportable for wrapping
        ['encrypt', 'decrypt']
      );

      logger.debug('Generated new master key');
      return key;
    } catch (error) {
      logger.error('Error generating master key', error);
      throw new Error('Failed to generate master key');
    }
  }

  /**
   * Set the master key for encryption/decryption operations
   * @param key The master key to set
   */
  public async setMasterKey(key: CryptoKey): Promise<void> {
    this.masterKey = key;
    this.initialized = true;

    // Persist to IndexedDB (survives tab close / PWA restart)
    await this.persistKeyToIDB();

    // Notify peer apps (Notes ↔ Task on same origin) so they can flip
    // hasE2E and skip the password prompt — IDB has the key and they
    // can read it directly.
    this.postKeyEvent('unlocked');

    // Zapisz tymczasową wersję klucza w sessionStorage, aby przetrwał nawigację
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        // Eksportuj klucz do formatu RAW
        const rawKey = await exportKey(key);
        // Zapisz jako Base64
        window.sessionStorage.setItem(this.TEMP_KEY_STORAGE_KEY, arrayBufferToBase64(rawKey));
        logger.debug('Temporary master key saved to session storage');

        // Zweryfikuj od razu poprawność klucza
        await this.verifyEncryption();
      } catch (error) {
        logger.error('Failed to save temporary master key to session storage:', error);
        // Kontynuuj nawet jeśli nie udało się zapisać - klucz nadal działa w pamięci
      }
    }

    logger.debug('Master key set');
  }

  /**
   * Clear the master key from memory
   */
  public clearMasterKey(): void {
    this.masterKey = null;
    this.initialized = false;

    // Clear IndexedDB (async, fire-and-forget)
    this.clearKeyFromIDB().catch((err) => {
      logger.error('Failed to clear master key from IndexedDB during clearMasterKey:', err);
    });

    // Wyczyść tymczasowy klucz z sessionStorage
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(this.TEMP_KEY_STORAGE_KEY);
      window.sessionStorage.removeItem(this.CRYPTO_VERIFIED_KEY);
      logger.debug('Temporary master key removed from session storage');
    }

    // Defense-in-depth — the primary logout path is the storage event on
    // `reborn_auth_credentials`. Peer apps that already handle that event
    // will treat this as a no-op; the broadcast only matters when someone
    // calls clearMasterKey() without touching credentials (rare/buggy).
    this.postKeyEvent('cleared');

    logger.debug('Master key cleared');
  }

  /**
   * Encrypt the master key with a user's password
   * @param masterKey The master key to encrypt
   * @param password The user's password
   * @returns Object containing the encrypted master key and salt
   */
  public async encryptMasterKey(
    masterKey: CryptoKey,
    password: string
  ): Promise<{
    encryptedMasterKey: string;
    salt: string;
  }> {
    try {
      // Generate a salt for key derivation
      const salt = await generateSalt();

      // Derive a key from the password
      const derivedKey = await deriveKeyFromPassword(password, salt);

      // Export the master key to raw format
      const masterKeyData = await exportKey(masterKey);

      // Convert the raw key data to a Base64 string for consistent handling
      const masterKeyBase64 = arrayBufferToBase64(masterKeyData);

      // Encrypt the master key with the derived key
      const { encryptedData, iv } = await encryptData(masterKeyBase64, derivedKey);

      // Combine IV and encrypted data for storage
      const encryptedMasterKeyWithIV = new Uint8Array(iv.length + encryptedData.length);
      encryptedMasterKeyWithIV.set(new Uint8Array(iv), 0);
      encryptedMasterKeyWithIV.set(new Uint8Array(encryptedData), iv.length);

      return {
        encryptedMasterKey: arrayBufferToBase64(encryptedMasterKeyWithIV),
        salt: arrayBufferToBase64(salt)
      };
    } catch (error) {
      logger.error('Error encrypting master key', error);
      throw new Error('Failed to encrypt master key');
    }
  }

  /**
   * Decrypt the master key with a user's password
   * @param encryptedMasterKey The encrypted master key (Base64)
   * @param salt The salt used for key derivation (Base64)
   * @param password The user's password
   * @returns The decrypted master key
   */
  public async decryptMasterKey(
    encryptedMasterKey: string,
    salt: string,
    password: string
  ): Promise<CryptoKey> {
    try {
      // Convert Base64 to ArrayBuffer
      const encryptedData = base64ToArrayBuffer(encryptedMasterKey);
      const saltData = base64ToArrayBuffer(salt);

      // Derive the key from the password
      const derivedKey = await deriveKeyFromPassword(password, saltData);

      // Extract IV and encrypted data
      const iv = encryptedData.slice(0, 12); // AES-GCM uses 12 bytes for IV
      const actualEncryptedData = encryptedData.slice(12);

      // Decrypt the master key (which is a Base64 string)
      const decryptedBase64 = (await decryptData(
        actualEncryptedData,
        derivedKey,
        iv,
        'string'
      )) as string;

      // Convert the Base64 string back to a Uint8Array
      const keyDataArray = base64ToArrayBuffer(decryptedBase64);

      // Import the decrypted key
      const masterKey = await importKey(keyDataArray, 'AES-GCM', ['encrypt', 'decrypt'], true);

      return masterKey;
    } catch (error) {
      logger.error('Error decrypting master key', error);
      throw new Error('Failed to decrypt master key');
    }
  }

  /**
   * Encrypt data using the master key
   * @param data Data to encrypt (string or object)
   * @returns Object containing the encrypted data and IV as Base64 strings
   */
  public async encrypt(data: string | object): Promise<{
    encryptedData: string;
    iv: string;
  }> {
    if (!this.isInitialized()) {
      throw new Error('CryptoManager not initialized with a master key');
    }

    try {
      const { encryptedData, iv } = await encryptData(data, this.masterKey!);

      return {
        encryptedData: arrayBufferToBase64(encryptedData),
        iv: arrayBufferToBase64(iv)
      };
    } catch (error) {
      logger.error('Error encrypting data', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt data using the master key
   * @param encryptedData Encrypted data (Base64)
   * @param iv Initialization vector (Base64)
   * @param asObject Whether to parse the decrypted data as JSON
   * @returns Decrypted data as string or object
   */
  public async decrypt<T = string>(
    encryptedData: string,
    iv: string,
    asObject = false
  ): Promise<T | string> {
    if (!this.isInitialized()) {
      throw new Error('CryptoManager not initialized with a master key');
    }

    try {
      const encryptedBuffer = base64ToArrayBuffer(encryptedData);
      const ivBuffer = base64ToArrayBuffer(iv);

      return (await decryptData<T>(
        encryptedBuffer,
        this.masterKey!,
        ivBuffer,
        asObject ? 'object' : 'string'
      )) as T | string;
    } catch (error) {
      logger.error('Error decrypting data', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Encrypt a string value using the master key
   * @param value String value to encrypt
   * @returns Encrypted string in format "iv:encryptedData" (Base64)
   */
  public async encryptString(value: string): Promise<string> {
    const { encryptedData, iv } = await this.encrypt(value);
    const result = `${iv}:${encryptedData}`;
    assertEncrypted(result);
    return result;
  }

  /**
   * Decrypt an encrypted string value using the master key
   * @param encryptedValue Encrypted string in format "iv:encryptedData" (Base64)
   * @returns Decrypted string value
   */
  public async decryptString(encryptedValue: string): Promise<string> {
    const [iv, encryptedData] = encryptedValue.split(':');
    if (!iv || !encryptedData) {
      throw new Error('Invalid encrypted value format');
    }

    return this.decrypt(encryptedData, iv) as Promise<string>;
  }

  /**
   * Encrypt an object using the master key
   * @param obj Object to encrypt
   * @returns Encrypted string in format "iv:encryptedData" (Base64)
   */
  public async encryptObject<T>(obj: T): Promise<string> {
    const { encryptedData, iv } = await this.encrypt(obj as unknown as object);
    return `${iv}:${encryptedData}`;
  }

  /**
   * Decrypt an encrypted object using the master key
   * @param encryptedValue Encrypted string in format "iv:encryptedData" (Base64)
   * @returns Decrypted object
   */
  public async decryptObject<T>(encryptedValue: string): Promise<T> {
    const [iv, encryptedData] = encryptedValue.split(':');
    if (!iv || !encryptedData) {
      throw new Error('Invalid encrypted value format');
    }

    return this.decrypt<T>(encryptedData, iv, true) as Promise<T>;
  }

  /**
   * Encrypt a text string using the master key
   * @param text Text to encrypt
   * @returns Encrypted text
   */
  public async encryptText(text: string): Promise<string> {
    // Always encrypt the text, even if it's empty
    // This ensures that empty descriptions are properly encrypted and stored
    return this.encryptString(text);
  }

  /**
   * Decrypt an encrypted text using the master key
   * @param encryptedText Encrypted text
   * @returns Decrypted text
   */
  public async decryptText(encryptedText: string): Promise<string> {
    // Return empty string if no encrypted text provided
    // This handles cases where description_encrypted is null/undefined
    if (!encryptedText) return '';
    return this.decryptString(encryptedText);
  }

  /**
   * Initialize CryptoManager with a string key
   * @param key String key to initialize with
   */
  /**
   * @internal Test-only helper — initializes CryptoManager with a raw string key.
   * NOT safe for production use (zero-pads short keys, no KDF).
   */
  public async initWithKey(key: string): Promise<void> {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
      throw new Error('initWithKey() is not allowed in production');
    }
    try {
      // Create a bytes array from the key
      const keyBytes = new TextEncoder().encode(key);

      // Ensure it's the right length (32 bytes for AES-256)
      const properKeyBytes = new Uint8Array(32);
      properKeyBytes.set(keyBytes.slice(0, 32));

      // If the key is shorter than 32 bytes, fill the rest with zeros
      if (keyBytes.length < 32) {
        properKeyBytes.fill(0, keyBytes.length);
      }

      // Import the key
      const masterKey = await crypto.subtle.importKey(
        'raw',
        properKeyBytes,
        { name: 'AES-GCM' },
        true, // extractable — master key
        ['encrypt', 'decrypt']
      );

      // Set the master key
      this.setMasterKey(masterKey);

      logger.debug('CryptoManager initialized with key');
    } catch (error) {
      logger.error('Failed to initialize with key:', error);
      throw new Error('Failed to initialize CryptoManager with key');
    }
  }

  /**
   * Export the current master key as ArrayBuffer
   * @returns The exported key as ArrayBuffer, or null if no key is loaded
   */
  public async exportCurrentKey(): Promise<ArrayBuffer | null> {
    if (!this.isInitialized() || !this.masterKey) {
      logger.warn('Cannot export key - no master key loaded');
      return null;
    }

    try {
      const exported = await exportKey(this.masterKey);
      if (exported instanceof ArrayBuffer) return exported;
      if (exported instanceof Uint8Array) {
        const ab = new ArrayBuffer(exported.byteLength);
        new Uint8Array(ab).set(exported);
        return ab;
      }
      return null;
    } catch (error) {
      logger.error('Failed to export current master key:', error);
      throw new Error('Failed to export master key');
    }
  }

  /**
   * Get the current master key
   * @returns The current master key, or null if no key is loaded
   */
  public getCurrentKey(): CryptoKey | null {
    return this.masterKey;
  }

  /**
   * Load user master key by decrypting it with password
   * @param encryptedMasterKey The encrypted master key (Base64)
   * @param salt The salt used for key derivation (Base64)
   * @param password The user's password
   * @returns true if key was loaded successfully
   */
  public async loadUserMasterKey(
    encryptedMasterKey: string,
    salt: string,
    password: string
  ): Promise<boolean> {
    try {
      const masterKey = await this.decryptMasterKey(encryptedMasterKey, salt, password);
      await this.setMasterKey(masterKey);
      return true;
    } catch (error) {
      logger.error('Failed to load user master key:', error);
      return false;
    }
  }

  // Expose utility methods from encryption module
  public base64ToArrayBuffer = base64ToArrayBuffer;
  public arrayBufferToBase64 = arrayBufferToBase64;
  public generateSalt = generateSalt;
  public deriveKeyFromPassword = deriveKeyFromPassword;
  public exportKey = exportKey;
  public importKey = importKey;

  /**
   * Encrypt raw data
   */
  public async encryptData(
    data: string | object | Uint8Array,
    key: CryptoKey,
    iv?: Uint8Array
  ): Promise<{ encryptedData: Uint8Array; iv: Uint8Array }> {
    return encryptData(data, key, iv);
  }

  /**
   * Decrypt raw data
   */
  public async decryptData<T = string>(
    encryptedData: Uint8Array,
    key: CryptoKey,
    iv: Uint8Array,
    returnType: 'string' | 'uint8array' | 'object' | boolean = 'string'
  ): Promise<T | string | Uint8Array> {
    return decryptData<T>(encryptedData, key, iv, returnType);
  }
}

// Export singleton instance
export const cryptoManager = CryptoManager.getInstance();
