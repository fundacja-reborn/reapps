/**
 * Password hashing utilities
 * Part of Zero Knowledge architecture - passwords are hashed client-side
 *
 * Supports:
 * - Argon2id (primary, recommended) via hash-wasm
 * - PBKDF2 (legacy, auto-detected in verification for migration)
 */

import { argon2id, argon2Verify } from 'hash-wasm';
import { createLogger } from '@reborn/utils';

const logger = createLogger('PasswordUtils');

// Argon2id configuration (OWASP 2025 recommended)
const ARGON2_MEMORY_COST = 19456; // 19 MiB
const ARGON2_TIME_COST = 3; // iterations (OWASP 2025: 1-3, using upper bound)
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32; // 32 bytes = 256 bits
const ARGON2_SALT_LENGTH = 32; // 32 bytes = 256 bits

// Legacy PBKDF2 constants (for verification only)
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT_LENGTH = 32;
const PBKDF2_KEY_LENGTH = 32;

/**
 * Generate a cryptographically secure salt
 * @param length - Salt length in bytes (default: 32)
 * @returns Base64 encoded salt
 */
export function generateSalt(length: number = ARGON2_SALT_LENGTH): string {
  const salt = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...salt));
}

/**
 * Convert a base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return array;
}

/**
 * Convert Uint8Array to base64 string
 */
function uint8ArrayToBase64(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array));
}

/**
 * Constant-time comparison of two strings.
 * Prevents timing attacks by always comparing all bytes regardless of mismatch.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a dummy comparison to avoid leaking length info via timing
    // (the length difference itself is already leaked by the if-check,
    //  but we ensure no early-exit on content)
    let result = 1; // nonzero = not equal
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Hash a password using Argon2id (recommended)
 * @param password - Plain text password
 * @param saltBase64 - Optional salt in base64 (will generate if not provided)
 * @returns Hash string in format "argon2id:v19:m=19456,t=3,p=1:SALT:HASH"
 */
export async function hashPassword(password: string, saltBase64?: string): Promise<string> {
  try {
    const salt = saltBase64
      ? base64ToUint8Array(saltBase64)
      : crypto.getRandomValues(new Uint8Array(ARGON2_SALT_LENGTH));
    const saltB64 = saltBase64 || uint8ArrayToBase64(salt);

    const hash = await argon2id({
      password,
      salt,
      parallelism: ARGON2_PARALLELISM,
      iterations: ARGON2_TIME_COST,
      memorySize: ARGON2_MEMORY_COST,
      hashLength: ARGON2_HASH_LENGTH,
      outputType: 'hex'
    });

    // Convert hex hash to base64 for compact storage
    const hashBytes = new Uint8Array(hash.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
    const hashB64 = uint8ArrayToBase64(hashBytes);

    const result = `argon2id:v19:m=${ARGON2_MEMORY_COST},t=${ARGON2_TIME_COST},p=${ARGON2_PARALLELISM}:${saltB64}:${hashB64}`;
    logger.debug('Password hashed successfully with Argon2id');
    return result;
  } catch (error) {
    logger.error('Password hashing failed:', error);
    throw new Error('Failed to hash password', { cause: error });
  }
}

/**
 * Hash a password using legacy PBKDF2 (for migration/testing only)
 * @deprecated Use hashPassword() which uses Argon2id
 */
export async function hashPasswordPBKDF2(password: string, saltBase64?: string): Promise<string> {
  try {
    const salt = saltBase64 || generateSalt(PBKDF2_SALT_LENGTH);
    const saltArray = base64ToUint8Array(salt);

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltArray.buffer as ArrayBuffer,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      PBKDF2_KEY_LENGTH * 8
    );

    const hash = uint8ArrayToBase64(new Uint8Array(derivedBits));
    return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hash}`;
  } catch (error) {
    logger.error('PBKDF2 password hashing failed:', error);
    throw new Error('Failed to hash password', { cause: error });
  }
}

/**
 * Verify a password against a hash string.
 * Auto-detects format: Argon2id or PBKDF2.
 * @param password - Plain text password
 * @param hashString - Hash string (argon2id:... or pbkdf2:...)
 * @returns True if password matches
 */
export async function verifyPassword(password: string, hashString: string): Promise<boolean> {
  try {
    if (isValidBcryptHash(hashString)) {
      logger.warn('Bcrypt hash detected - not supported in E2E architecture');
      throw new Error('Bcrypt hashes are not supported in browser environment');
    }

    if (hashString.startsWith('argon2id:')) {
      return await verifyArgon2id(password, hashString);
    }

    if (hashString.startsWith('pbkdf2:')) {
      return await verifyPBKDF2(password, hashString);
    }

    throw new Error('Unknown hash format');
  } catch (error) {
    logger.error('Password verification failed:', error);
    throw new Error('Failed to verify password', { cause: error });
  }
}

/**
 * Verify password against Argon2id hash.
 * Uses hash-wasm's built-in verification which reconstructs the encoded hash.
 */
async function verifyArgon2id(password: string, hashString: string): Promise<boolean> {
  const parts = hashString.split(':');
  // Format: argon2id:v19:m=19456,t=2,p=1:SALT_B64:HASH_B64
  if (parts.length !== 5 || parts[0] !== 'argon2id') {
    throw new Error('Invalid Argon2id hash format');
  }

  const [, , paramsStr, saltB64, hashB64] = parts;
  const salt = base64ToUint8Array(saltB64);

  // Parse params
  const params: Record<string, number> = {};
  for (const param of paramsStr.split(',')) {
    const [key, val] = param.split('=');
    params[key] = parseInt(val, 10);
  }

  // Re-hash with same params and compare
  const newHash = await argon2id({
    password,
    salt,
    parallelism: params['p'] || ARGON2_PARALLELISM,
    iterations: params['t'] || ARGON2_TIME_COST,
    memorySize: params['m'] || ARGON2_MEMORY_COST,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: 'hex'
  });

  const newHashBytes = new Uint8Array(newHash.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
  const newHashB64 = uint8ArrayToBase64(newHashBytes);

  const isValid = constantTimeEqual(newHashB64, hashB64);
  logger.debug('Argon2id password verification completed:', isValid);
  return isValid;
}

/**
 * Verify password against legacy PBKDF2 hash (constant-time).
 */
async function verifyPBKDF2(password: string, hashString: string): Promise<boolean> {
  const parts = hashString.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    throw new Error('Invalid PBKDF2 hash format');
  }

  const [, iterationsStr, salt, expectedHash] = parts;
  const iterations = parseInt(iterationsStr, 10);

  if (isNaN(iterations) || iterations < 1000) {
    throw new Error('Invalid iteration count');
  }

  const saltArray = base64ToUint8Array(salt);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltArray.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH * 8
  );

  const newHash = uint8ArrayToBase64(new Uint8Array(derivedBits));
  const isValid = constantTimeEqual(newHash, expectedHash);
  logger.debug('PBKDF2 password verification completed:', isValid);
  return isValid;
}

/**
 * Generate a bcrypt-style salt (for compatibility)
 * NOTE: This doesn't actually generate a bcrypt salt, just returns a format string
 * @deprecated Use generateSalt() instead
 */
export async function generateBcryptSalt(rounds = 12): Promise<string> {
  logger.warn('generateBcryptSalt called - bcrypt is not supported in browser');
  throw new Error('Bcrypt is not supported in browser environment');
}

/**
 * Validate password strength
 * @param password - Password to validate
 * @returns Object with validation result and score
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length < 8) feedback.push('Password should be at least 8 characters long');

  // Character variety checks
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  // Common patterns check
  const commonPatterns = ['123', 'abc', 'password', 'qwerty'];
  const lowerPassword = password.toLowerCase();
  if (!commonPatterns.some((pattern) => lowerPassword.includes(pattern))) {
    score += 1;
  } else {
    feedback.push('Avoid common patterns');
  }

  // Feedback based on missing criteria
  if (!/[a-z]/.test(password)) feedback.push('Add lowercase letters');
  if (!/[A-Z]/.test(password)) feedback.push('Add uppercase letters');
  if (!/[0-9]/.test(password)) feedback.push('Add numbers');
  if (!/[^a-zA-Z0-9]/.test(password)) feedback.push('Add special characters');

  return {
    isValid: score >= 4,
    score: Math.min(Math.round((score / 7) * 5), 5), // Convert to 0-5 scale
    feedback
  };
}

/**
 * Check if a string is a valid bcrypt hash
 * @param hash - String to check
 * @returns boolean - True if valid bcrypt hash format
 */
export function isValidBcryptHash(hash: string): boolean {
  // Bcrypt hashes are 60 characters long and start with $2a$, $2b$, or $2y$
  return /^\$2[aby]\$\d{2}\$.{53}$/.test(hash);
}

/**
 * Get the number of rounds from a bcrypt hash
 * @param hash - bcrypt hash
 * @returns number - Number of rounds, or -1 if invalid
 */
export function getBcryptRounds(hash: string): number {
  if (!isValidBcryptHash(hash)) {
    return -1;
  }

  const match = hash.match(/^\$2[aby]\$(\d{2})\$/);
  return match ? parseInt(match[1], 10) : -1;
}

/**
 * Check if a string is a valid PBKDF2 hash
 * @param hash - String to check
 * @returns boolean - True if valid PBKDF2 hash format
 */
export function isValidPBKDF2Hash(hash: string): boolean {
  const parts = hash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return false;
  }

  const [, iterationsStr, salt, hashPart] = parts;
  const iterations = parseInt(iterationsStr, 10);

  return !isNaN(iterations) && iterations >= 1000 && salt.length > 0 && hashPart.length > 0;
}

/**
 * Check if a string is a valid Argon2id hash
 * @param hash - String to check
 * @returns boolean - True if valid Argon2id hash format
 */
export function isValidArgon2Hash(hash: string): boolean {
  const parts = hash.split(':');
  if (parts.length !== 5 || parts[0] !== 'argon2id') {
    return false;
  }

  const [, version, params, salt, hashPart] = parts;
  if (!version.startsWith('v')) return false;

  // Validate params contain m=, t=, p=
  const hasRequiredParams = /m=\d+/.test(params) && /t=\d+/.test(params) && /p=\d+/.test(params);

  return hasRequiredParams && salt.length > 0 && hashPart.length > 0;
}
