import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { generatePowChallenge, signChallenge } from '@reborn/auth/server';

/**
 * GET /api/auth/pow
 * Generate a signed Proof-of-Work challenge for registration bot protection.
 * Rate limited in hooks.server.ts (10 req / 5 min / IP).
 */
export const GET: RequestHandler = async () => {
  const challenge = generatePowChallenge();
  const signed = signChallenge(challenge);

  return json({ success: true, data: signed });
};
