/**
 * Client-side Proof-of-Work solver using Web Crypto API.
 *
 * Iterates nonces and computes SHA-256 hashes until finding the one
 * matching the server's challenge. Processing is done in batches to
 * avoid blocking the UI thread.
 */

export interface PowChallengeData {
  salt: string;
  challenge: string;
  difficulty: number;
  expiresAt: number;
  signature: string;
}

const BATCH_SIZE = 2048;

/**
 * Convert an ArrayBuffer to a hex string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const hexChars: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    hexChars[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return hexChars.join('');
}

/**
 * Yield control back to the browser between batches.
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Solve a PoW challenge by brute-forcing the nonce.
 *
 * @param challenge - Challenge data from the server
 * @returns The nonce that produces the matching hash
 * @throws If the challenge expires or no solution is found
 */
export async function solvePowChallenge(challenge: PowChallengeData): Promise<number> {
  const maxNumber = Math.pow(2, challenge.difficulty);
  const encoder = new TextEncoder();

  for (let start = 0; start < maxNumber; start += BATCH_SIZE) {
    // Check expiry
    if (Date.now() > challenge.expiresAt) {
      throw new Error('PoW challenge expired before solution was found');
    }

    const end = Math.min(start + BATCH_SIZE, maxNumber);

    for (let nonce = start; nonce < end; nonce++) {
      const data = encoder.encode(`${challenge.salt}:${nonce}`);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hash = bufferToHex(hashBuffer);

      if (hash === challenge.challenge) {
        return nonce;
      }
    }

    // Yield to main thread between batches to keep UI responsive
    await yieldToMain();
  }

  throw new Error('PoW challenge: no solution found within difficulty range');
}
