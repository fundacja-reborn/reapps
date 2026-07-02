/**
 * Password-based envelope encryption: PBKDF2 600K + AES-256-GCM - the exact
 * recipe behind the apps' "portable encrypted backup". Centralized here so the
 * manual export, the automated backup engine and the restore path all share one
 * audited implementation instead of re-deriving the same steps inline (the two
 * apps previously each inlined an identical salt/derive/encrypt/base64 dance).
 *
 * Zero Knowledge: keyed by a USER secret (a backup recovery phrase or an export
 * password), never the account master key. Only the resulting envelope
 * (salt + iv + ciphertext, all base64) is meant to leave the device; plaintext
 * exists transiently in memory between decrypt and re-encrypt.
 */

import {
  deriveKeyFromPassword,
  encryptData,
  decryptData,
  generateSalt,
  arrayBufferToBase64,
  base64ToArrayBuffer
} from './encryption';
import { isValidRecoveryPhrase, normalizeRecoveryPhrase } from './recovery-phrase';

/** Algorithm marker stored in envelopes; matches existing v3 / portable files. */
export const PASSWORD_ENVELOPE_ALGORITHM = 'aes-256-gcm-pbkdf2';

/** PBKDF2 salt length in bytes - matches the apps' existing portable exports. */
const SALT_BYTES = 16;

/** The base64 parts that identify and unlock a password-encrypted payload. */
export interface PasswordEnvelopeParts {
  /** base64 PBKDF2 salt. */
  salt: string;
  /** base64 AES-GCM IV. */
  iv: string;
  /** base64 AES-GCM ciphertext. */
  data: string;
}

/**
 * Encrypt `plaintext` under a key derived from `password` (PBKDF2 600K) with a
 * fresh random salt and IV. Returns the base64 envelope parts; callers wrap them
 * in whatever versioned envelope their format needs (e.g. notes BackupV3,
 * task PortableEncryptedExport).
 */
export async function encryptWithPassword(
  plaintext: string,
  password: string
): Promise<PasswordEnvelopeParts> {
  const salt = await generateSalt(SALT_BYTES);
  const key = await deriveKeyFromPassword(password, salt);
  const { encryptedData, iv } = await encryptData(plaintext, key);
  return {
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(encryptedData)
  };
}

/**
 * Inverse of {@link encryptWithPassword}: re-derive the key from `password` and
 * the envelope's salt, then AES-GCM-decrypt to the original UTF-8 string. Throws
 * if the password is wrong or the ciphertext was tampered with (AES-GCM is
 * authenticated), so a successful return doubles as an integrity check.
 */
export async function decryptWithPassword(
  envelope: PasswordEnvelopeParts,
  password: string
): Promise<string> {
  const key = await deriveKeyFromPassword(password, base64ToArrayBuffer(envelope.salt));
  const plaintext = await decryptData(
    base64ToArrayBuffer(envelope.data),
    key,
    base64ToArrayBuffer(envelope.iv),
    'string'
  );
  return plaintext as string;
}

/**
 * {@link decryptWithPassword}, tolerant of recovery-phrase re-typing. The KDF
 * canonically receives the NORMALIZED phrase (see `normalizeRecoveryPhrase`),
 * but a user restoring a backup types the phrase from paper - with numbering,
 * capitals or line breaks - and the raw form then fails as a generic "wrong
 * password", which reads as a corrupt backup (audit 012 N4). When the input
 * parses as a valid recovery phrase whose normalized form differs, that form
 * is tried as a second candidate. The raw input stays FIRST so a deliberate
 * password that merely looks like a phrase keeps working; the extra attempt
 * costs one more PBKDF2 derivation, only on the failure path.
 */
export async function decryptWithPasswordOrPhrase(
  envelope: PasswordEnvelopeParts,
  input: string
): Promise<string> {
  const candidates = [input];
  if (isValidRecoveryPhrase(input)) {
    const normalized = normalizeRecoveryPhrase(input);
    if (normalized !== input) candidates.push(normalized);
  }
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await decryptWithPassword(envelope, candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
