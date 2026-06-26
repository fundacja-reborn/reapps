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
