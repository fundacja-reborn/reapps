import { describe, it, expect } from 'vitest';
import {
  generateRecoveryPhrase,
  normalizeRecoveryPhrase,
  isValidRecoveryPhrase,
  RECOVERY_PHRASE_FORMAT
} from '../recovery-phrase';
import { BIP39_ENGLISH } from '../bip39-wordlist';

describe('Recovery phrase', () => {
  describe('generateRecoveryPhrase', () => {
    it('produces 12 lowercase, space-separated words', () => {
      const phrase = generateRecoveryPhrase();
      const words = phrase.split(' ');
      expect(words).toHaveLength(RECOVERY_PHRASE_FORMAT.wordCount);
      expect(phrase).toBe(phrase.toLowerCase());
      expect(phrase).not.toMatch(/\s{2,}/);
    });

    it('only uses words from the BIP-0039 wordlist', () => {
      const wordset = new Set(BIP39_ENGLISH);
      for (let i = 0; i < 20; i++) {
        for (const word of generateRecoveryPhrase().split(' ')) {
          expect(wordset.has(word)).toBe(true);
        }
      }
    });

    it('is effectively unique across calls (no fixed seed)', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 100; i++) seen.add(generateRecoveryPhrase());
      expect(seen.size).toBe(100);
    });

    it('every generated phrase validates', () => {
      for (let i = 0; i < 50; i++) {
        expect(isValidRecoveryPhrase(generateRecoveryPhrase())).toBe(true);
      }
    });
  });

  describe('normalizeRecoveryPhrase', () => {
    it('lowercases and collapses whitespace', () => {
      expect(normalizeRecoveryPhrase('  Vivid   SCOUT\tribbon\n')).toBe('vivid scout ribbon');
    });

    it('tolerates list numbering and punctuation as separators', () => {
      expect(normalizeRecoveryPhrase('1. abandon 2. ability 3. zoo')).toBe('abandon ability zoo');
      expect(normalizeRecoveryPhrase('abandon, ability, zoo')).toBe('abandon ability zoo');
    });

    it('is idempotent on an already-canonical phrase', () => {
      const phrase = generateRecoveryPhrase();
      expect(normalizeRecoveryPhrase(phrase)).toBe(phrase);
    });

    it('produces the same canonical key input regardless of user formatting', () => {
      const phrase = generateRecoveryPhrase();
      const messy = phrase
        .split(' ')
        .map((w, i) => `${i + 1}. ${w.toUpperCase()}`)
        .join('\n');
      expect(normalizeRecoveryPhrase(messy)).toBe(phrase);
    });
  });

  describe('isValidRecoveryPhrase', () => {
    it('accepts a generated phrase with assorted user formatting', () => {
      const phrase = generateRecoveryPhrase();
      expect(isValidRecoveryPhrase(phrase)).toBe(true);
      expect(isValidRecoveryPhrase(phrase.toUpperCase())).toBe(true);
      expect(isValidRecoveryPhrase(`  ${phrase.replace(/ /g, '   ')}  `)).toBe(true);
    });

    it('rejects the wrong number of words', () => {
      expect(isValidRecoveryPhrase('')).toBe(false);
      expect(isValidRecoveryPhrase('abandon ability able')).toBe(false);
      expect(isValidRecoveryPhrase(generateRecoveryPhrase() + ' zoo')).toBe(false);
    });

    it('rejects phrases containing a non-wordlist word', () => {
      const words = generateRecoveryPhrase().split(' ');
      words[5] = 'zzzzz'; // pure letters, definitely not in the BIP-0039 list
      expect(isValidRecoveryPhrase(words.join(' '))).toBe(false);
    });
  });
});
