import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  hashPasswordPBKDF2,
  verifyPassword,
  constantTimeEqual,
  validatePasswordStrength,
  generateBcryptSalt,
  isValidBcryptHash,
  isValidPBKDF2Hash,
  isValidArgon2Hash,
  getBcryptRounds
} from '../index';
import { generateSalt } from '../password';

describe('Password Utils', () => {
  describe('hashPassword (Argon2id)', () => {
    it('should hash a password with Argon2id', async () => {
      const password = 'mySecurePassword123!';
      const hash = await hashPassword(password);

      expect(hash).toBeTruthy();
      expect(hash).not.toBe(password);
      expect(hash.startsWith('argon2id:')).toBe(true);
      expect(isValidArgon2Hash(hash)).toBe(true);
    });

    it('should generate different hashes for the same password', async () => {
      const password = 'mySecurePassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty password', async () => {
      // hash-wasm Argon2id may reject empty passwords
      await expect(hashPassword('')).rejects.toThrow('Failed to hash password');
    });

    it('should include correct parameters in hash format', async () => {
      const hash = await hashPassword('test');
      const parts = hash.split(':');
      expect(parts[0]).toBe('argon2id');
      expect(parts[1]).toBe('v19');
      expect(parts[2]).toContain('m=19456');
      expect(parts[2]).toContain('t=3');
      expect(parts[2]).toContain('p=1');
    });
  });

  describe('hashPasswordPBKDF2 (legacy)', () => {
    it('should hash a password with PBKDF2', async () => {
      const hash = await hashPasswordPBKDF2('test');
      expect(hash.startsWith('pbkdf2:')).toBe(true);
      expect(isValidPBKDF2Hash(hash)).toBe(true);
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct Argon2id password', async () => {
      const password = 'mySecurePassword123!';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password (Argon2id)', async () => {
      const password = 'mySecurePassword123!';
      const wrongPassword = 'wrongPassword123!';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(wrongPassword, hash);
      expect(isValid).toBe(false);
    });

    it('should verify correct PBKDF2 password (legacy)', async () => {
      const password = 'legacyPassword123!';
      const hash = await hashPasswordPBKDF2(password);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect PBKDF2 password (legacy)', async () => {
      const hash = await hashPasswordPBKDF2('correct');
      const isValid = await verifyPassword('wrong', hash);
      expect(isValid).toBe(false);
    });

    it('should handle empty password verification', async () => {
      const hash = await hashPassword('password');
      // hash-wasm Argon2id may reject empty passwords
      await expect(verifyPassword('', hash)).rejects.toThrow();
    });

    it('should throw for unknown hash format', async () => {
      await expect(verifyPassword('test', 'unknown:format')).rejects.toThrow();
    });

    it('should throw for bcrypt hash', async () => {
      await expect(
        verifyPassword('test', '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234')
      ).rejects.toThrow();
    });
  });

  describe('constantTimeEqual', () => {
    it('should return true for equal strings', () => {
      expect(constantTimeEqual('hello', 'hello')).toBe(true);
      expect(constantTimeEqual('', '')).toBe(true);
      expect(constantTimeEqual('abc123!@#', 'abc123!@#')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(constantTimeEqual('hello', 'world')).toBe(false);
      expect(constantTimeEqual('abc', 'abd')).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(constantTimeEqual('short', 'longer string')).toBe(false);
      expect(constantTimeEqual('longer string', 'short')).toBe(false);
    });

    it('should handle single character difference', () => {
      expect(constantTimeEqual('aaaa', 'aaab')).toBe(false);
      expect(constantTimeEqual('baaa', 'aaaa')).toBe(false);
    });
  });

  describe('validatePasswordStrength', () => {
    it('should validate strong password', () => {
      // Use a password that does not contain common patterns (123, abc, password, qwerty)
      const result = validatePasswordStrength('MySecure!@Pass99');

      expect(result.isValid).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(4);
      expect(result.feedback).toHaveLength(0);
    });

    it('should reject weak password', () => {
      const result = validatePasswordStrength('weak');

      expect(result.isValid).toBe(false);
      expect(result.score).toBeLessThan(4);
      expect(result.feedback.length).toBeGreaterThan(0);
    });

    it('should provide feedback for missing criteria', () => {
      // Short lowercase-only input so score < 4
      const result = validatePasswordStrength('lowonly');

      expect(result.isValid).toBe(false);
      expect(result.feedback).toContain('Add uppercase letters');
      expect(result.feedback).toContain('Add numbers');
      expect(result.feedback).toContain('Add special characters');
    });

    it('should detect common patterns', () => {
      const result = validatePasswordStrength('Password123!');

      expect(result.feedback).toContain('Avoid common patterns');
    });

    it('should validate password length', () => {
      const shortResult = validatePasswordStrength('Ab1!');
      expect(shortResult.feedback).toContain('Password should be at least 8 characters long');

      const longResult = validatePasswordStrength('MyVeryLongPassword123!');
      expect(longResult.score).toBeGreaterThanOrEqual(4);
    });
  });

  describe('generateSalt', () => {
    it('should generate salt with default length (32 bytes)', () => {
      const salt = generateSalt();
      expect(salt).toBeTruthy();
      // Base64 encoded 32 bytes = 44 characters
      expect(salt.length).toBeGreaterThanOrEqual(40);
    });

    it('should generate salt with custom length', () => {
      const salt = generateSalt(16);
      expect(salt).toBeTruthy();
      expect(salt.length).toBeGreaterThanOrEqual(20);
    });

    it('should generate unique salts', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toBe(salt2);
    });
  });

  describe('hash format validators', () => {
    it('isValidArgon2Hash should validate correct Argon2id hash', async () => {
      const hash = await hashPassword('test');
      expect(isValidArgon2Hash(hash)).toBe(true);
    });

    it('isValidArgon2Hash should reject invalid formats', () => {
      expect(isValidArgon2Hash('invalid')).toBe(false);
      expect(isValidArgon2Hash('pbkdf2:100000:salt:hash')).toBe(false);
      expect(isValidArgon2Hash('')).toBe(false);
    });

    it('isValidPBKDF2Hash should validate correct PBKDF2 hash', async () => {
      const hash = await hashPasswordPBKDF2('test');
      expect(isValidPBKDF2Hash(hash)).toBe(true);
    });

    it('isValidPBKDF2Hash should reject invalid formats', () => {
      expect(isValidPBKDF2Hash('invalid')).toBe(false);
      expect(isValidPBKDF2Hash('argon2id:v19:m=19456:salt:hash')).toBe(false);
    });

    it('isValidBcryptHash should reject non-bcrypt', () => {
      expect(isValidBcryptHash('invalid')).toBe(false);
      expect(isValidBcryptHash('$2a$10$short')).toBe(false);
      expect(isValidBcryptHash('')).toBe(false);
    });

    it('getBcryptRounds should return -1 for invalid hash', () => {
      expect(getBcryptRounds('invalid')).toBe(-1);
    });
  });

  describe('bcrypt legacy', () => {
    it('generateBcryptSalt should throw', async () => {
      await expect(generateBcryptSalt()).rejects.toThrow('Bcrypt is not supported');
    });
  });
});
