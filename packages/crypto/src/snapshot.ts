/**
 * Snapshot share crypto helpers.
 *
 * A "snapshot share" is a frozen, encrypted view of a single note or task that
 * is exposed via a public URL. The decryption key lives in the URL fragment
 * (`#k=...`) and NEVER touches the server (RFC 3986 §3.5).
 *
 * Key flow:
 *   - Client generates a fresh 256-bit AES-GCM key per share
 *   - Client encrypts the snapshot payload (JSON) with that key
 *   - Client uploads `iv:ciphertext` (Base64) to the server
 *   - Client also wraps the raw key with the owner's master key
 *     (`owner_key_wrapped`) so the same user can recover the URL on another
 *     device. Master key never leaves the client, so server cannot unwrap.
 *
 * Format: payload ciphertext is stored as `iv:ciphertext` where both halves
 * are standard Base64 — same shape as every other `*_encrypted` field in the
 * repo, so it passes the existing Encryption Guard regex.
 */

import { createLogger } from '@reborn/utils';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  decryptData,
  encryptData,
  exportKey,
  importKey
} from './encryption';

const logger = createLogger('SnapshotCrypto');

/** Length of the snapshot key in bytes (AES-GCM 256). */
const SNAPSHOT_KEY_BYTES = 32;

/**
 * Generate a fresh extractable AES-GCM 256-bit key for a single share.
 *
 * Extractable so the raw bytes can be exported to base64url for the URL
 * fragment AND wrapped by the owner's master key for cross-device sync.
 */
export async function generateSnapshotKey(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(SNAPSHOT_KEY_BYTES));
  return importKey(raw, 'AES-GCM', ['encrypt', 'decrypt'], true);
}

/**
 * Export a snapshot key to base64url (no padding) — the URL-fragment form.
 */
export async function exportKeyToBase64url(key: CryptoKey): Promise<string> {
  const raw = await exportKey(key);
  return arrayBufferToBase64(raw, true);
}

/**
 * Import a snapshot key from its base64url representation.
 *
 * `extractable` defaults to `false` for recipient-side decryption — owners
 * wanting to re-display the URL on another device should re-derive from the
 * wrapped key instead. Pass `true` only if you must re-export.
 */
export async function importKeyFromBase64url(
  base64url: string,
  extractable = false
): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64url);
  if (raw.byteLength !== SNAPSHOT_KEY_BYTES) {
    throw new Error(
      `Snapshot key must be ${SNAPSHOT_KEY_BYTES} bytes, got ${raw.byteLength}`
    );
  }
  return importKey(raw, 'AES-GCM', ['encrypt', 'decrypt'], extractable);
}

/**
 * Encrypt a snapshot payload object with the per-share key.
 *
 * Returns the `iv:ciphertext` (Base64) wire format used for the
 * `payload_encrypted` column.
 */
export async function encryptSnapshotPayload(
  payload: unknown,
  key: CryptoKey
): Promise<string> {
  const plaintext = JSON.stringify(payload);
  const { encryptedData, iv } = await encryptData(plaintext, key);
  return `${arrayBufferToBase64(iv)}:${arrayBufferToBase64(encryptedData)}`;
}

/**
 * Decrypt a snapshot payload from its `iv:ciphertext` wire form.
 *
 * Throws on malformed envelope or AES-GCM auth failure (wrong key, tampered
 * ciphertext). Caller is expected to Zod-validate the returned JSON shape.
 */
export async function decryptSnapshotPayload<T = unknown>(
  blob: string,
  key: CryptoKey
): Promise<T> {
  const separatorIndex = blob.indexOf(':');
  if (separatorIndex === -1) {
    throw new Error('Snapshot blob missing iv:ciphertext separator');
  }
  const ivBase64 = blob.substring(0, separatorIndex);
  const ciphertextBase64 = blob.substring(separatorIndex + 1);

  const iv = base64ToArrayBuffer(ivBase64);
  const ciphertext = base64ToArrayBuffer(ciphertextBase64);

  try {
    const decrypted = await decryptData<T>(ciphertext, key, iv, 'object');
    return decrypted as T;
  } catch (error) {
    logger.error('Snapshot payload decryption failed (wrong key or tampered ciphertext)');
    throw new Error('Snapshot decryption failed', { cause: error });
  }
}

/**
 * Build the public share URL for a given app and slug, embedding the key
 * (raw base64url) and format version in the URL fragment.
 *
 * Example: `buildShareUrl('https://reapps.eu/notes', 'AbCd1234EfGh5678', '...key...', 1)`
 *   -> `'https://reapps.eu/notes/s/AbCd1234EfGh5678#k=...&v=1'`
 *
 * The fragment portion is never sent over the wire — receiver's browser only.
 */
export function buildShareUrl(
  baseUrl: string,
  slug: string,
  keyBase64url: string,
  version: number
): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return `${trimmed}/s/${slug}#k=${keyBase64url}&v=${version}`;
}

/**
 * Parse the `#k=...&v=...` fragment from a public share URL.
 *
 * Returns null when the fragment is missing the key — public page should
 * render an informative "incomplete link" error rather than try to fetch.
 */
export function parseShareFragment(hash: string): { key: string; version: number } | null {
  if (!hash) return null;
  const cleaned = hash.startsWith('#') ? hash.substring(1) : hash;
  const params = new URLSearchParams(cleaned);
  const key = params.get('k');
  if (!key) return null;
  const versionRaw = params.get('v');
  const version = versionRaw ? Number.parseInt(versionRaw, 10) : 1;
  return { key, version: Number.isFinite(version) ? version : 1 };
}
