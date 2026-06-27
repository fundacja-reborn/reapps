/**
 * Post-write integrity self-test for the automated backup. `runAutoBackup`
 * stays crypto-free, so the app injects this: read the bytes back from disk and
 * prove they decrypt with the recovery phrase. If they don't, the runner
 * deletes the file - a backup that cannot be restored is worse than none, and
 * detecting that the moment it is written (not years later in a disaster) is the
 * whole point.
 */

import { decryptWithPassword, type PasswordEnvelopeParts } from '@reborn/crypto';

/** Narrow an arbitrary parsed object to the {salt, iv, data} envelope shape. */
function asEnvelopeParts(value: unknown): PasswordEnvelopeParts {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.salt === 'string' && typeof v.iv === 'string' && typeof v.data === 'string') {
      return { salt: v.salt, iv: v.iv, data: v.data };
    }
  }
  throw new Error('Backup self-test failed: file is not a recognised encrypted envelope.');
}

/**
 * Throw unless `writtenContent` is a valid backup envelope that decrypts with
 * `phrase` to valid JSON. Resolves silently on success.
 */
export async function verifyBackup(writtenContent: string, phrase: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(writtenContent);
  } catch {
    throw new Error('Backup self-test failed: written file is not valid JSON.');
  }

  const parts = asEnvelopeParts(parsed);
  // Throws on a wrong phrase or tampered ciphertext (AES-GCM auth tag).
  const plaintext = await decryptWithPassword(parts, phrase);

  try {
    JSON.parse(plaintext);
  } catch {
    throw new Error('Backup self-test failed: decrypted payload is not valid JSON.');
  }
}
