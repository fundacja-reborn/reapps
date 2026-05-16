/**
 * Server-side helpers for SharedSnapshot routes.
 *
 * Slug generation and collision retry live here so the route handlers stay thin.
 * Zero-knowledge invariants:
 *   - The server never decrypts payload_encrypted nor unwraps owner_key_wrapped.
 *   - Generated slug is unique random output, not derived from user content.
 */

import { prisma } from '@reborn/database';
import { SHARE_SLUG_LENGTH } from '@reborn/types';

/**
 * Generate a base64url slug of SHARE_SLUG_LENGTH chars.
 * 16 chars = 96 bits of entropy. Collision odds at 1M shares ≈ 1/10^14.
 */
function randomSlug(): string {
  // SHARE_SLUG_LENGTH = 16 → 12 random bytes → base64url (no padding) = 16 chars.
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').slice(0, SHARE_SLUG_LENGTH);
}

/**
 * Pick a slug that does not collide with an existing row. Retries up to
 * `attempts` times — collisions at 96-bit entropy are statistically impossible
 * but we still guard against UNIQUE constraint races.
 */
export async function generateUniqueShareSlug(attempts = 3): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const candidate = randomSlug();
    const existing = await prisma.sharedSnapshot.findUnique({
      where: { slug: candidate },
      select: { id: true }
    });
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate unique share slug after retries');
}
