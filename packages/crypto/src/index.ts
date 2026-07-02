/**
 * @reborn/crypto - Cryptographic operations for Reborn Apps
 *
 * This package provides E2E encryption functionality for the Reborn Apps suite,
 * including key management, encryption/decryption, and secure data handling.
 */

// CryptoManager - main crypto operations class
export { CryptoManager, cryptoManager } from './cryptoManager';
export type { CryptoKeyEvent, KeyEventHandler, MasterKeyVault } from './cryptoManager';

// Encryption utilities
export {
  generateSalt,
  generateIV,
  deriveKeyFromPassword,
  encryptData,
  decryptData,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  exportKey,
  importKey
} from './encryption';

// Key management functions
export {
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
} from './keyManager';

// Encryption validation guards
export {
  isValidEncryptedFormat,
  assertEncrypted,
  validateEncryptedPayload,
  detectPlaintextLeaks,
  KNOWN_SENSITIVE_FIELDS
} from './encryption-validation';

// Cross-key readability probe (wrong-account backup import / stale IDB rows)
export { isEncryptedDataReadable } from './decrypt-probe';

// Password-based envelope encryption (PBKDF2 + AES-GCM) for portable backups
export {
  encryptWithPassword,
  decryptWithPassword,
  decryptWithPasswordOrPhrase,
  PASSWORD_ENVELOPE_ALGORITHM
} from './password-envelope';
export type { PasswordEnvelopeParts } from './password-envelope';

// Local-mode passcode policy (shared min length, failure throttle, soft quality)
export {
  LOCAL_PASSCODE_MIN_LENGTH,
  UNLOCK_THROTTLE_FREE_ATTEMPTS,
  UNLOCK_THROTTLE_MAX_DELAY_MS,
  unlockThrottleDelayMs,
  isTriviallyGuessablePasscode,
  LocalPasscodeThrottledError
} from './local-passcode';

// Backup recovery phrase (user-held secret that encrypts automated backups)
export {
  generateRecoveryPhrase,
  normalizeRecoveryPhrase,
  isValidRecoveryPhrase,
  RECOVERY_PHRASE_FORMAT
} from './recovery-phrase';

// Snapshot share helpers (per-share AES-GCM key, URL fragment transport)
export {
  generateSnapshotKey,
  exportKeyToBase64url,
  importKeyFromBase64url,
  encryptSnapshotPayload,
  decryptSnapshotPayload,
  buildShareUrl,
  parseShareFragment
} from './snapshot';

// Password hashing functions
export {
  hashPassword,
  hashPasswordPBKDF2,
  verifyPassword,
  constantTimeEqual,
  validatePasswordStrength,
  generateSalt as generatePasswordSalt,
  generateBcryptSalt,
  isValidBcryptHash,
  isValidPBKDF2Hash,
  isValidArgon2Hash,
  getBcryptRounds
} from './password';

// Type exports
export type EncryptedData = {
  encryptedData: string;
  iv: string;
};

export type EncryptedMasterKey = {
  encryptedMasterKey: string;
  salt: string;
};
