/**
 * Backup recovery phrase: the user-held secret that encrypts automated backups.
 *
 * Auto-backup (see `planning/auto-backup-zk.md`) must be encryptable WITHOUT
 * user interaction (a copy of this phrase lives in the OS vault) yet restorable
 * with ONLY this phrase plus the backup file - no account, no account password,
 * no server. So the phrase is deliberately DECOUPLED from the account password:
 *   - it survives an account-password change,
 *   - it can restore into a fresh account (new reapps.eu account or self-host),
 *   - the vault copy only powers unattended backups; the user MUST also record
 *     the phrase externally, because on a new device the vault copy is gone too.
 *
 * Format: a 12-word "seed phrase" drawn uniformly from the BIP-0039 English
 * wordlist (132 bits of entropy, far above what is needed once stretched by
 * PBKDF2 600K in {@link deriveKeyFromPassword}). The familiar wallet-style seed
 * phrase was chosen over a random code for recognizability and user trust. We
 * vendor only the wordlist as data - there is no BIP-0039 dependency and we do
 * NOT use BIP-0039 checksum/derivation; the words are simply a memorable,
 * high-entropy passphrase.
 *
 * The CANONICAL value fed to the KDF is the normalized form (see
 * {@link normalizeRecoveryPhrase}): lowercase words separated by single spaces.
 * Always derive keys from the normalized form so that a user re-typing the
 * phrase with different casing, spacing, numbering or punctuation on restore
 * reproduces the exact same key.
 */

import { createLogger } from '@reborn/utils';
import { BIP39_ENGLISH } from './bip39-wordlist';

const logger = createLogger('RecoveryPhrase');

/** Number of words in a recovery phrase. 12 x 11 bits = 132 bits of entropy. */
const WORD_COUNT = 12;

/** Word index space size (BIP-0039 list length). Must be a power of two. */
const WORDLIST_SIZE = 2048; // 2^11

/** Fast membership set for validation, built once from the wordlist. */
const WORDSET = new Set(BIP39_ENGLISH);

/**
 * Generate a fresh 12-word recovery phrase (lowercase, space-separated).
 *
 * Uniform over the wordlist: a 16-bit random value masked to 11 bits has 32
 * preimages per index (65536 = 32 x 2048), so `& (WORDLIST_SIZE - 1)`
 * introduces no modulo bias.
 *
 * @returns e.g. `"vivid scout ... ribbon"`
 */
export function generateRecoveryPhrase(): string {
  const rand = crypto.getRandomValues(new Uint16Array(WORD_COUNT));
  const words: string[] = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    words.push(BIP39_ENGLISH[rand[i] & (WORDLIST_SIZE - 1)]);
  }
  return words.join(' ');
}

/**
 * Reduce any user-entered or generated phrase to its canonical KDF input:
 * lowercase words joined by single spaces. Splits on any run of non-letters, so
 * extra spaces, line breaks, list numbering (`1. abandon`) and stray
 * punctuation are all tolerated.
 *
 * This is the ONLY form that should ever be passed to the key-derivation step,
 * both when storing a freshly generated phrase and when accepting one on
 * restore.
 *
 * @param input Raw phrase as typed or generated.
 */
export function normalizeRecoveryPhrase(input: string): string {
  return input
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * Validate that `input` normalizes to a well-formed recovery phrase: exactly
 * {@link WORD_COUNT} words, each present in the wordlist. Does NOT prove it is
 * the *correct* phrase for a given backup - that is only known when decryption
 * succeeds.
 *
 * @param input Raw phrase as typed.
 */
export function isValidRecoveryPhrase(input: string): boolean {
  const words = normalizeRecoveryPhrase(input).split(' ').filter(Boolean);
  if (words.length !== WORD_COUNT) return false;
  for (const word of words) {
    if (!WORDSET.has(word)) {
      logger.debug('recovery phrase contains a word outside the BIP-0039 list');
      return false;
    }
  }
  return true;
}

/** Format constants, exported for UI affordances and tests. */
export const RECOVERY_PHRASE_FORMAT = {
  wordCount: WORD_COUNT,
  language: 'en',
  separator: ' ',
  wordlistSize: WORDLIST_SIZE
} as const;
