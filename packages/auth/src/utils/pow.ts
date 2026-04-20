/**
 * Proof-of-Work challenge system for bot protection.
 *
 * Server generates a challenge; client must find the nonce that produces
 * the matching SHA-256 hash. Verification is O(1). Challenges are signed
 * with HMAC-SHA256 to prevent tampering.
 *
 * Privacy-preserving: no external scripts, no tracking, no cookies.
 */

import { createHmac, randomUUID, createHash } from 'crypto';

// ── Types ─────────────────────────────────────────────────────────

export interface PowChallenge {
  /** Random salt for this challenge */
  salt: string;
  /** SHA-256 hash that client must reproduce */
  challenge: string;
  /** Max number of iterations (2^difficulty) */
  difficulty: number;
  /** Expiry timestamp (epoch ms) */
  expiresAt: number;
}

export interface SignedPowChallenge extends PowChallenge {
  /** HMAC-SHA256 signature of the challenge data */
  signature: string;
}

// ── Configuration ─────────────────────────────────────────────────

const DEFAULT_DIFFICULTY = 18; // 2^18 = 262144 iterations, ~100-300ms on modern device
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getPowSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET not set — cannot sign PoW challenges');
    }
    return 'development-pow-secret';
  }
  return secret;
}

// ── Used challenge tracking (replay prevention) ───────────────────

const usedSalts = new Set<string>();

// Evict expired entries every 5 minutes
setInterval(() => {
  usedSalts.clear();
}, CHALLENGE_TTL_MS).unref();

// ── Core functions ────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of `salt:nonce` (server-side, using Node crypto).
 */
function computeHash(salt: string, nonce: number): string {
  return createHash('sha256').update(`${salt}:${nonce}`).digest('hex');
}

/**
 * Generate a PoW challenge. The server picks a random nonce, computes
 * the target hash, and returns everything except the nonce.
 */
export function generatePowChallenge(difficulty?: number): PowChallenge {
  const diff = difficulty ?? getConfiguredDifficulty();
  const maxNumber = Math.pow(2, diff);
  const salt = randomUUID();
  const nonce = Math.floor(Math.random() * maxNumber);
  const challenge = computeHash(salt, nonce);

  return {
    salt,
    challenge,
    difficulty: diff,
    expiresAt: Date.now() + CHALLENGE_TTL_MS
  };
}

/**
 * Verify a PoW solution: check expiry, replay, and hash match.
 */
export function verifyPowSolution(challenge: PowChallenge, solution: number): boolean {
  // Check expiry
  if (Date.now() > challenge.expiresAt) {
    return false;
  }

  // Check replay (same salt used twice)
  if (usedSalts.has(challenge.salt)) {
    return false;
  }

  // Verify hash
  const hash = computeHash(challenge.salt, solution);
  if (hash !== challenge.challenge) {
    return false;
  }

  // Mark as used
  usedSalts.add(challenge.salt);
  return true;
}

/**
 * Sign a challenge with HMAC-SHA256 to prevent client-side tampering.
 */
export function signChallenge(challenge: PowChallenge): SignedPowChallenge {
  const payload = `${challenge.salt}:${challenge.challenge}:${challenge.difficulty}:${challenge.expiresAt}`;
  const signature = createHmac('sha256', getPowSecret()).update(payload).digest('hex');

  return { ...challenge, signature };
}

/**
 * Verify signature and extract challenge data from a signed challenge.
 * Returns null if signature is invalid.
 */
export function verifySignedChallenge(signed: SignedPowChallenge): PowChallenge | null {
  const payload = `${signed.salt}:${signed.challenge}:${signed.difficulty}:${signed.expiresAt}`;
  const expected = createHmac('sha256', getPowSecret()).update(payload).digest('hex');

  // Constant-time comparison
  if (expected.length !== signed.signature.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signed.signature.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  return {
    salt: signed.salt,
    challenge: signed.challenge,
    difficulty: signed.difficulty,
    expiresAt: signed.expiresAt
  };
}

/**
 * Read difficulty from env or use default.
 */
function getConfiguredDifficulty(): number {
  const env = process.env.POW_DIFFICULTY;
  if (env) {
    const n = parseInt(env, 10);
    if (!isNaN(n) && n >= 10 && n <= 24) return n;
  }
  return DEFAULT_DIFFICULTY;
}
