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

export type CryptoKeyEvent = 'unlocked' | 'cleared' | 'locked';

export type KeyEventHandler = (event: CryptoKeyEvent) => void;

/**
 * Pluggable at-rest persistence for the master key (raw bytes, Base64).
 *
 * Default (no vault, web): the master key is persisted as an extractable
 * CryptoKey in IndexedDB plus a raw Base64 export in sessionStorage -
 * browsers offer no hardware-backed alternative. Native shells (Capacitor)
 * inject a vault backed by the platform key store (Android Keystore /
 * iOS Keychain) via `setMasterKeyVault()`: only the Keystore/Keychain-wrapped
 * ciphertext ever touches disk and the wrapping key is non-extractable.
 * With a vault set, the IndexedDB and sessionStorage persistence paths are
 * disabled (and legacy copies from pre-vault builds are purged on restore).
 *
 * Implementations must swallow platform errors and degrade to "no key"
 * (`load()` → null): the caller then falls back to the password unlock
 * screen, and the next successful unlock re-writes the vault entry.
 */
export interface MasterKeyVault {
  /** Persist the raw master key (Base64). */
  save(rawKeyBase64: string): Promise<void>;
  /** Read the persisted master key (Base64), or null when absent / on error. */
  load(): Promise<string | null>;
  /** Remove the persisted master key (logout / corrupt entry). */
  clear(): Promise<void>;
}

export class CryptoManager {
  private static instance: CryptoManager;
  private masterKey: CryptoKey | null = null;
  private initialized = false;
  private readonly TEMP_KEY_STORAGE_KEY = 'TEMP_MASTER_KEY_EXPORT';
  private readonly CRYPTO_VERIFIED_KEY = 'CRYPTO_VERIFICATION_SUCCESS';
  private readonly IDB_NAME = 'reborn_crypto_keys';
  private readonly IDB_STORE = 'master_key';
  private readonly IDB_KEY_ID = 'current';
  /**
   * localStorage key for the optional local-mode passcode wrap:
   * `{ wrapped, salt, v }` - the local master key encrypted with
   * PBKDF2(passcode). Kept in localStorage (not IndexedDB) because it is plain
   * ciphertext+salt (safe at rest), is shared across both same-origin apps like
   * the other local-mode markers, survives a cold start, and reads
   * synchronously so `isLocalPasscodeEnabled()` needs no async restore. See
   * planning/local-only-no-account-plan.md (decision A1).
   */
  private readonly LOCAL_PASSCODE_WRAP_KEY = 'reborn_local_passcode_wrap';
  private readonly WRAP_FORMAT_VERSION = 1;
  private restoreKeyAttempted = false;
  private restorePromise: Promise<boolean> | null = null;
  private vault: MasterKeyVault | null = null;

  // Cross-app key event channel — single instance with a fanout list of
  // subscribers so HMR re-subscribing doesn't allocate extra channels.
  private channel: BroadcastChannel | null = null;
  private channelInitialized = false;
  private keyEventHandlers: Set<KeyEventHandler> = new Set();

  // Private constructor for singleton pattern
  private constructor() {
    // Restoration is started lazily on the first ensureRestoreStarted() call
    // (waitForRestore / unwrap / verify / persist), NOT in the constructor.
    // Reason: importing @reborn/crypto from the public share view
    // (apps/*/src/routes/s/[slug]/+page.svelte) would otherwise open the
    // `reborn_crypto_keys` IndexedDB for every anonymous viewer even though
    // the snapshot decryption uses only crypto.subtle with the URL-fragment
    // key and never needs the master key. See guideline 59 rule #12.
  }

  /**
   * Start the (idempotent) key-restoration flow on demand. The first call
   * kicks off restoreKeyOnStartup(); subsequent calls return the same
   * promise so multiple callers share a single IDB open + key import.
   */
  private ensureRestoreStarted(): Promise<boolean> {
    if (!this.restorePromise) {
      this.restorePromise = this.restoreKeyOnStartup();
    }
    return this.restorePromise;
  }

  /**
   * Inject a platform key vault (native shells). MUST be called before the
   * first waitForRestore() - the restoration source is decided when the
   * lazy restore actually runs. Web never calls this: without a vault the
   * IndexedDB/sessionStorage behavior below is byte-for-byte the old one.
   */
  public setMasterKeyVault(vault: MasterKeyVault): void {
    if (this.restorePromise) {
      logger.warn(
        'setMasterKeyVault called after key restoration started - restore already used the default persistence'
      );
    }
    this.vault = vault;
  }

  /**
   * Orchestrates key restoration on startup.
   * Vault injected (native): vault → one-time IndexedDB migration → null.
   * Default (web): IndexedDB (persistent) → sessionStorage (fallback) → null.
   */
  private async restoreKeyOnStartup(): Promise<boolean> {
    try {
      // Passcode gate (web + native): if a local passcode wrap exists, the
      // master key is intentionally NOT at-rest in the clear. Load no key - the
      // app shows the local lock screen and unlocks via
      // `unlockWithLocalPasscode()`. Runs before every other source so a stale
      // raw key can never bypass the passcode.
      if (this.hasLocalPasscodeWrap()) {
        this.restoreKeyAttempted = true;
        logger.info('Local passcode set - key locked, awaiting passcode unlock');
        return false;
      }

      // 0. Vault (native) - the platform key store is the single source of
      // truth. IndexedDB is only consulted to migrate (then purge) a key
      // persisted by a pre-vault build; the sessionStorage raw-key copy is
      // purged outright (Chromium-based webviews persist Session Storage to
      // disk, which is exactly what the vault exists to avoid).
      if (this.vault) {
        const restored = await this.restoreKeyFromVault();
        if (!restored) {
          await this.migrateLegacyKeyToVault();
        }
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem(this.TEMP_KEY_STORAGE_KEY);
        }
        this.restoreKeyAttempted = true;
        return this.isInitialized();
      }

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

  // ── Vault persistence (native shells) ────────────────────────

  /** Persist the master key to the injected vault (raw bytes, Base64). */
  private async persistKeyToVault(): Promise<void> {
    if (!this.vault || !this.masterKey) return;
    try {
      const rawKey = await exportKey(this.masterKey);
      await this.vault.save(arrayBufferToBase64(rawKey));
      logger.debug('Master key persisted to vault');
    } catch (error) {
      // The in-memory key keeps this session working; the next cold start
      // falls back to the unlock screen and a successful unlock re-saves.
      logger.error('Failed to persist master key to vault:', error);
    }
  }

  /**
   * Restore the master key from the vault. A non-null entry that fails to
   * import or verify is treated as corrupt and removed - self-healing: the
   * user lands on the unlock screen and the next unlock overwrites it.
   */
  private async restoreKeyFromVault(): Promise<boolean> {
    if (!this.vault) return false;
    const rawKeyBase64 = await this.vault.load().catch(() => null);
    if (!rawKeyBase64) return false;

    try {
      const key = await importKey(
        base64ToArrayBuffer(rawKeyBase64),
        'AES-GCM',
        ['encrypt', 'decrypt'],
        true
      );
      this.masterKey = key;
      this.initialized = true;
      await this.verifyEncryption();
      logger.info('Successfully restored master key from vault');
      return true;
    } catch (error) {
      logger.error('Vault-restored key failed to import/verify - clearing entry:', error);
      this.masterKey = null;
      this.initialized = false;
      await this.vault.clear().catch(() => {
        // Best-effort - a failed delete leaves a corrupt entry that the next
        // restore attempt will fail (and retry clearing) the same way.
      });
      return false;
    }
  }

  /**
   * One-time migration from pre-vault builds, which persisted an extractable
   * CryptoKey in IndexedDB: move it into the vault and purge the IDB copy so
   * no extractable key material stays on disk.
   */
  private async migrateLegacyKeyToVault(): Promise<void> {
    if (!this.vault) return;
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return;

    const idbKey = await this.restoreKeyFromIDB();
    if (!idbKey) return;

    this.masterKey = idbKey;
    this.initialized = true;
    try {
      await this.verifyEncryption();
    } catch (verifyError) {
      logger.error('Legacy IndexedDB key failed verification during vault migration:', verifyError);
      this.masterKey = null;
      this.initialized = false;
      await this.clearKeyFromIDB();
      return;
    }

    await this.persistKeyToVault();
    await this.clearKeyFromIDB();
    logger.info('Master key migrated from IndexedDB to vault');
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
    // Trigger lazy restoration on first wait. Pages that never call this
    // (e.g. the public snapshot view) never open the crypto IDB.
    const restorePromise = this.ensureRestoreStarted();

    // Clear the timer the moment the restore promise wins the race — otherwise
    // the setTimeout callback still fires (with its `resolve(false)` ignored)
    // and emits a spurious "timed out" warning even when restore finished in
    // milliseconds. waitForRestore is called from multiple places per cold
    // start, so an unguarded timer produces one bogus warning per caller.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        restorePromise,
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
        if (
          !data ||
          (data.type !== 'unlocked' && data.type !== 'cleared' && data.type !== 'locked')
        )
          return;
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

      throw new Error('Encryption verification failed', { cause: error });
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
      throw new Error('Failed to generate master key', { cause: error });
    }
  }

  /**
   * Set the master key for encryption/decryption operations
   * @param key The master key to set
   */
  public async setMasterKey(key: CryptoKey): Promise<void> {
    this.masterKey = key;
    this.initialized = true;

    // Establishing a fresh at-rest key (account login/upgrade, or returning to
    // base local mode) invalidates any prior local passcode wrap - remove it so
    // a stale wrap can't lock the user out with an old passcode on next start.
    this.removeLocalPasscodeWrap();

    if (this.vault) {
      // Native: the vault is the ONLY at-rest copy - no extractable
      // CryptoKey in IndexedDB, no raw-key export in sessionStorage
      // (Chromium-based webviews persist Session Storage to disk). Legacy
      // copies a pre-vault build may have written are purged defensively.
      await this.persistKeyToVault();
      void this.clearKeyFromIDB();
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(this.TEMP_KEY_STORAGE_KEY);
      }

      this.postKeyEvent('unlocked');

      try {
        // Same self-test as the web path below - a failure is logged but the
        // in-memory key stays usable.
        await this.verifyEncryption();
      } catch (error) {
        logger.error('Encryption verification after unlock failed:', error);
      }

      logger.debug('Master key set');
      return;
    }

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

    // Clear the vault entry (native) - fire-and-forget like the IDB clear.
    if (this.vault) {
      this.vault.clear().catch((err) => {
        logger.error('Failed to clear master key from vault during clearMasterKey:', err);
      });
    }

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
      throw new Error('Failed to encrypt master key', { cause: error });
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
      throw new Error('Failed to decrypt master key', { cause: error });
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
      throw new Error('Failed to encrypt data', { cause: error });
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
      throw new Error('Failed to decrypt data', { cause: error });
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
      throw new Error('Failed to initialize CryptoManager with key', { cause: error });
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
      throw new Error('Failed to export master key', { cause: error });
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

  // ── Local-mode passcode (optional at-rest wrap) ──────────────
  //
  // Opt-in lock for local-only / no-account mode. The local master key is
  // wrapped with PBKDF2(passcode) (reusing encryptMasterKey/decryptMasterKey,
  // 600K iterations) and only the wrap is kept at-rest; the key lives in memory
  // and must be re-entered after each cold start / hard reload. Mirrors the
  // Standard Notes "Application Passcode" / Proton PIN model. Web-first; the raw
  // key is also purged from the native vault on enable so a vault build composes
  // cleanly. See planning/local-only-no-account-plan.md (decision A1).

  /** Read the persisted passcode wrap record, or null when none/invalid. */
  private readLocalPasscodeWrapRecord(): { wrapped: string; salt: string; v: number } | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(this.LOCAL_PASSCODE_WRAP_KEY);
    if (!raw) return null;
    try {
      const rec = JSON.parse(raw) as { wrapped?: string; salt?: string; v?: number };
      if (!rec?.wrapped || !rec?.salt) return null;
      return { wrapped: rec.wrapped, salt: rec.salt, v: rec.v ?? 1 };
    } catch {
      return null;
    }
  }

  /** Whether a local passcode wrap is present (synchronous). */
  private hasLocalPasscodeWrap(): boolean {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(this.LOCAL_PASSCODE_WRAP_KEY) !== null;
  }

  /** Remove the persisted passcode wrap (best-effort). */
  private removeLocalPasscodeWrap(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(this.LOCAL_PASSCODE_WRAP_KEY);
  }

  /**
   * Persist the passcode wrap. The stored value is AES-GCM ciphertext - the
   * master key wrapped with PBKDF2(passcode) - plus a non-secret salt and a
   * version tag. Safe at rest: this is the same envelope model as the account's
   * server-side `encrypted_master_key`, and strictly stronger than the
   * no-passcode baseline (a raw key in IndexedDB). The plaintext key is never
   * written here - the wrap cannot be opened without the passcode.
   */
  private writeLocalPasscodeWrap(wrapped: string, salt: string): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      throw new Error('Local passcode requires a browser environment');
    }
    window.localStorage.setItem(
      this.LOCAL_PASSCODE_WRAP_KEY,
      JSON.stringify({ wrapped, salt, v: this.WRAP_FORMAT_VERSION })
    );
  }

  /**
   * Whether an optional local passcode is currently set. Synchronous and valid
   * before restore completes (reads localStorage directly), so auth guards and
   * settings UI can branch on it immediately.
   */
  public isLocalPasscodeEnabled(): boolean {
    return this.hasLocalPasscodeWrap();
  }

  /**
   * Whether a local passcode is set but the key is not in memory - i.e. the app
   * should show the local lock screen (passcode set AND not initialized).
   */
  public isLocalPasscodeLocked(): boolean {
    return this.hasLocalPasscodeWrap() && !this.isInitialized();
  }

  /**
   * Enable an optional local passcode. Wraps the in-memory master key with
   * PBKDF2(passcode), persists only the wrap, and purges every cleartext at-rest
   * copy of the key (IndexedDB, sessionStorage, native vault). The key stays in
   * memory so the current session continues unlocked; the lock takes effect on
   * the next cold start / hard reload. Requires an initialized key.
   */
  public async enableLocalPasscode(passcode: string): Promise<void> {
    if (!this.isInitialized() || !this.masterKey) {
      throw new Error('Cannot set a local passcode without an unlocked master key');
    }
    if (!passcode) throw new Error('Passcode must not be empty');
    if (typeof window === 'undefined' || !window.localStorage) {
      throw new Error('Local passcode requires a browser environment');
    }

    const { encryptedMasterKey, salt } = await this.encryptMasterKey(this.masterKey, passcode);
    this.writeLocalPasscodeWrap(encryptedMasterKey, salt);

    // Purge every cleartext at-rest copy - the wrap is now the only on-disk form.
    await this.clearKeyFromIDB();
    if (this.vault) {
      await this.vault.clear().catch((err) => {
        logger.error('Failed to clear vault while enabling local passcode:', err);
      });
    }
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(this.TEMP_KEY_STORAGE_KEY);
    }

    logger.info('Local passcode enabled - master key wrapped at-rest');
  }

  /**
   * Unlock the local master key with the passcode. Decrypts the wrap into a
   * memory-only key (no at-rest persistence - the wrap remains the only on-disk
   * form). Returns false on a wrong passcode or when no passcode is set.
   */
  public async unlockWithLocalPasscode(passcode: string): Promise<boolean> {
    const record = this.readLocalPasscodeWrapRecord();
    if (!record) {
      logger.warn('unlockWithLocalPasscode called with no passcode wrap present');
      return false;
    }
    try {
      const key = await this.decryptMasterKey(record.wrapped, record.salt, passcode);
      this.masterKey = key;
      this.initialized = true;
      // Memory-only on purpose: do NOT persist to IndexedDB/sessionStorage/vault,
      // and do NOT broadcast `unlocked` (peers have no at-rest key to read).
      await this.verifyEncryption();
      logger.info('Local master key unlocked with passcode');
      return true;
    } catch {
      logger.warn('Local passcode unlock failed (wrong passcode or corrupt wrap)');
      this.masterKey = null;
      this.initialized = false;
      return false;
    }
  }

  /**
   * Change the local passcode. Verifies `currentPasscode` against the stored
   * wrap, then re-wraps the in-memory key with `newPasscode`. Requires an
   * unlocked key. Returns false if the current passcode is wrong.
   */
  public async changeLocalPasscode(
    currentPasscode: string,
    newPasscode: string
  ): Promise<boolean> {
    if (!this.isInitialized() || !this.masterKey) {
      throw new Error('Cannot change the local passcode without an unlocked master key');
    }
    if (!newPasscode) throw new Error('New passcode must not be empty');

    const record = this.readLocalPasscodeWrapRecord();
    if (!record) throw new Error('No local passcode is set');
    try {
      await this.decryptMasterKey(record.wrapped, record.salt, currentPasscode);
    } catch {
      return false; // current passcode wrong
    }

    const { encryptedMasterKey, salt } = await this.encryptMasterKey(this.masterKey, newPasscode);
    this.writeLocalPasscodeWrap(encryptedMasterKey, salt);
    logger.info('Local passcode changed');
    return true;
  }

  /**
   * Disable the local passcode and return to base local mode: removes the wrap
   * and re-persists the (in-memory) key at-rest in the clear, exactly like a
   * no-passcode local session. Requires an unlocked key.
   */
  public async disableLocalPasscode(): Promise<void> {
    if (!this.isInitialized() || !this.masterKey) {
      throw new Error('Cannot disable the local passcode without an unlocked master key');
    }
    const key = this.masterKey;
    // setMasterKey removes the wrap + clears passcodeMode and re-persists the
    // raw key (IndexedDB/sessionStorage/vault), restoring cross-app auto-unlock.
    await this.setMasterKey(key);
    logger.info('Local passcode disabled - returned to base local mode');
  }

  /**
   * Lock the app now: clear the in-memory key while keeping the wrap, so the
   * lock screen reappears. Broadcasts `locked` so a peer app on the same origin
   * locks too. No cleartext key is left anywhere. Pass `{ broadcast: false }`
   * when reacting to a peer's `locked` event to avoid an echo.
   */
  public lockLocal(opts: { broadcast?: boolean } = {}): void {
    const { broadcast = true } = opts;
    this.masterKey = null;
    this.initialized = false;
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(this.CRYPTO_VERIFIED_KEY);
    }
    if (broadcast) this.postKeyEvent('locked');
    logger.debug('Local key locked (passcode required to unlock)');
  }

  /**
   * Forget the local passcode without an unlocked key - the "forgot passcode"
   * reset path. Removes the wrap and any in-memory key. The caller is
   * responsible for wiping local data (the wrapped data is unrecoverable
   * without the passcode). Does not broadcast.
   */
  public forgetLocalPasscode(): void {
    this.removeLocalPasscodeWrap();
    this.masterKey = null;
    this.initialized = false;
    logger.info('Local passcode forgotten (reset path)');
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
