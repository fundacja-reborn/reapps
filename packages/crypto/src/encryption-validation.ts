/**
 * Encryption validation guards for defence-in-depth protection.
 *
 * These utilities verify that encrypted field values conform to the expected
 * `iv:ciphertext` base64 format AND that no sensitive plaintext fields leak
 * into payloads bound for the server. They are used at three levels:
 *   1. Post-encrypt assertion (cryptoManager.encryptString)
 *   2. Pre-save guard (@reborn/storage — before IndexedDB write)
 *   3. Pre-sync guard (api-client interceptor & reborn-notes push*)
 *
 * Design decisions:
 *   - Auto-detect fields by `_encrypted` suffix — no changes needed when adding new fields
 *   - Fail-fast (throw) — better to block a write than leak plaintext
 *   - Always active in production — security layer, not dev-only
 *   - null/undefined values are skipped (optional fields like description_encrypted)
 *   - Logger.error includes field name but NEVER the value
 *   - Plaintext leak detection only runs on payloads that already contain at
 *     least one `_encrypted` field — i.e. entity-shaped objects bound for the
 *     server. This avoids false positives on settings/sync/auth payloads.
 */

import { createLogger } from '@reborn/utils';

const logger = createLogger('EncryptionValidation');

// Standard base64 character set (including padding)
const BASE64_REGEX = /^[A-Za-z0-9+/]+=*$/;

// Minimum length: 12-byte IV → 16 chars base64, separator, at least some ciphertext
const MIN_IV_BASE64_LENGTH = 16;
const MIN_CIPHERTEXT_BASE64_LENGTH = 4;

/**
 * Check if a string is valid standard base64.
 */
function isBase64(value: string): boolean {
  if (value.length === 0) return false;
  return BASE64_REGEX.test(value);
}

/**
 * Validates that a value conforms to the encrypted format `<base64-iv>:<base64-ciphertext>`.
 *
 * Rules:
 *   - Exactly one `:` separator
 *   - Both parts are valid base64
 *   - IV part has minimum length (12 bytes → ≥16 base64 chars)
 *   - Ciphertext part has minimum length
 *
 * @returns `true` if the value looks like properly encrypted data
 */
export function isValidEncryptedFormat(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;

  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) return false;

  // Must have exactly one separator
  if (value.indexOf(':', separatorIndex + 1) !== -1) return false;

  const ivPart = value.substring(0, separatorIndex);
  const ciphertextPart = value.substring(separatorIndex + 1);

  if (ivPart.length < MIN_IV_BASE64_LENGTH) return false;
  if (ciphertextPart.length < MIN_CIPHERTEXT_BASE64_LENGTH) return false;

  return isBase64(ivPart) && isBase64(ciphertextPart);
}

/**
 * Asserts that a value is in the valid encrypted format.
 * Throws an Error if the value does not conform.
 *
 * @param value - The encrypted string to validate
 * @param fieldName - Optional field name for diagnostic logging (value is NEVER logged)
 */
export function assertEncrypted(value: string, fieldName?: string): void {
  if (!isValidEncryptedFormat(value)) {
    const context = fieldName ? ` (field: ${fieldName})` : '';
    logger.error(
      `Encrypted field validation failed${context} — value does not match iv:ciphertext base64 format`
    );
    throw new Error(
      `Encryption guard: invalid encrypted format${context}. ` +
        'Expected base64-iv:base64-ciphertext. Blocking write to prevent plaintext leak.'
    );
  }
}

/**
 * Names of plaintext fields that should NEVER appear on entity payloads
 * destined for the server. Their authoritative copies live inside the
 * matching `*_encrypted` field (or inside `metadata_encrypted` for behavioural
 * metadata). This list mirrors the field names that the encryption layer
 * encrypts before sync.
 *
 * Detection only runs when the payload already contains at least one
 * `_encrypted` field (i.e. it is an entity payload, not a setting or auth
 * request) — see `validateEncryptedPayload`.
 */
export const KNOWN_SENSITIVE_FIELDS = [
  'title',
  'name',
  'description',
  'content',
  'color',
  'metadata'
] as const;

/**
 * Detect plaintext leaks in an entity payload.
 *
 * Two complementary checks:
 *   1. **Sibling check** — for every `<base>_encrypted` field present, the
 *      sibling `<base>` plaintext field MUST NOT also be present. Catches
 *      regressions where a developer forgot to drop the plaintext source
 *      after encrypting.
 *   2. **Known-sensitive check** — none of `KNOWN_SENSITIVE_FIELDS` may appear
 *      in plaintext on an entity payload. Catches cases where the plaintext
 *      and encrypted forms use different base names.
 *
 * `null` / `undefined` plaintext values are tolerated (defensive — they carry
 * no information).
 *
 * @throws Error if any plaintext leak is detected
 */
export function detectPlaintextLeaks(data: Record<string, unknown>): void {
  const keys = Object.keys(data);

  // Check 1: sibling fields — `<base>` next to `<base>_encrypted`
  for (const key of keys) {
    if (!key.endsWith('_encrypted')) continue;
    const base = key.slice(0, -'_encrypted'.length);
    if (base.length === 0) continue;
    if (!(base in data)) continue;

    const plaintextValue = data[base];
    if (plaintextValue === null || plaintextValue === undefined) continue;

    logger.error(
      `Plaintext leak: field "${base}" present alongside "${key}" — possible regression`
    );
    throw new Error(
      `Encryption guard: plaintext field "${base}" must not be sent alongside "${key}". ` +
        'Drop the plaintext source after encrypting. Blocking write to prevent plaintext leak.'
    );
  }

  // Check 2: well-known sensitive plaintext fields
  for (const field of KNOWN_SENSITIVE_FIELDS) {
    if (!(field in data)) continue;
    const value = data[field];
    if (value === null || value === undefined) continue;

    logger.error(
      `Plaintext leak: known-sensitive field "${field}" present on entity payload`
    );
    throw new Error(
      `Encryption guard: known-sensitive field "${field}" must not be sent as plaintext. ` +
        `Encrypt it first (expected "${field}_encrypted" or inside metadata_encrypted). ` +
        'Blocking write to prevent plaintext leak.'
    );
  }
}

/**
 * Validates all `*_encrypted` fields in a data object.
 *
 * Iterates over every key ending with `_encrypted`. For each:
 *   - null/undefined → skipped (optional fields)
 *   - string → must pass `assertEncrypted()`
 *   - other type → throws (unexpected type for encrypted field)
 *
 * If at least one encrypted field is present, the payload is treated as an
 * entity payload bound for the server and `detectPlaintextLeaks()` runs as
 * an additional defence-in-depth check.
 *
 * @param data - Object with potential encrypted fields
 * @throws Error if any encrypted field contains invalid (possibly plaintext) data
 *               or if a sensitive plaintext field is detected.
 */
export function validateEncryptedPayload(data: Record<string, unknown>): void {
  if (typeof data !== 'object' || data === null) return;

  let hasEncryptedField = false;

  for (const key of Object.keys(data)) {
    if (!key.endsWith('_encrypted')) continue;

    const value = data[key];

    // Optional fields may be null/undefined — skip them
    if (value === null || value === undefined) continue;

    if (typeof value !== 'string') {
      logger.error(`Encrypted field has unexpected type (field: ${key}, type: ${typeof value})`);
      throw new Error(
        `Encryption guard: field "${key}" has type "${typeof value}" instead of string. ` +
          'Blocking write to prevent plaintext leak.'
      );
    }

    assertEncrypted(value, key);
    hasEncryptedField = true;
  }

  // Only run plaintext leak detection on entity payloads (those that contain
  // at least one valid encrypted field). Settings / auth / sync-state payloads
  // never carry encrypted fields and must not trip the leak detector.
  if (hasEncryptedField) {
    detectPlaintextLeaks(data);
  }
}
