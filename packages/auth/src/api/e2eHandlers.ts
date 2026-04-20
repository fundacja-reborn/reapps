/**
 * E2E-specific registration handler
 * Accepts pre-hashed password and pre-generated master key
 */

import { createLogger } from '@reborn/utils';
import { schemas } from '@reborn/types';
import { v4 as uuidv4 } from 'uuid';
import type { RegisterResult, AuthUser } from '../types';
import type { HandlerOptions, ApiResponse } from './handlers';
import { generateTokens as generateJwtTokens } from '../utils/jwt';
import { verifySignedChallenge, verifyPowSolution } from '../utils/pow';
import type { SignedPowChallenge } from '../utils/pow';

const logger = createLogger('E2EAuthHandler');

/** Minimum time (ms) a human needs to fill the registration form. */
const MIN_FORM_TIME_MS = 2000;

/**
 * Handle E2E user registration
 * Password is already hashed and master key is already generated on client side
 */
export async function handleE2ERegister(
  data: unknown,
  options: HandlerOptions
): Promise<ApiResponse<RegisterResult>> {
  try {
    // Validate input using E2E schema
    const validationResult = schemas.E2ERegisterRequestSchema.safeParse(data);
    if (!validationResult.success) {
      return {
        success: false,
        error: 'Invalid registration data'
      };
    }

    const {
      username,
      passwordHash,
      encryptedMasterKey,
      masterKeySalt,
      preferred_language = 'en',
      website,
      _t,
      powChallenge: powChallengeJson,
      powSolution,
      defaultTaskList
    } = validationResult.data;

    // ── Bot protection layer 1: Honeypot ────────────────────────
    if (website) {
      logger.debug('Registration rejected: honeypot triggered');
      return { success: false, error: 'Registration failed' };
    }

    // ── Bot protection layer 2: Timing check ────────────────────
    if (_t != null) {
      const elapsed = Date.now() - _t;
      if (elapsed < MIN_FORM_TIME_MS) {
        logger.debug('Registration rejected: form submitted too fast');
        return { success: false, error: 'Registration failed' };
      }
    }

    // ── Bot protection layer 3: Proof-of-Work (required) ───────
    if (powChallengeJson == null || powSolution == null) {
      logger.debug('Registration rejected: missing PoW challenge or solution');
      return { success: false, error: 'Registration failed' };
    }

    {
      let signed: SignedPowChallenge;
      try {
        signed = JSON.parse(powChallengeJson);
      } catch {
        return { success: false, error: 'Registration failed' };
      }

      const challenge = verifySignedChallenge(signed);
      if (!challenge) {
        logger.debug('Registration rejected: invalid PoW signature');
        return { success: false, error: 'Registration failed' };
      }

      if (!verifyPowSolution(challenge, powSolution)) {
        logger.debug('Registration rejected: invalid PoW solution');
        return { success: false, error: 'Registration failed' };
      }
    }

    const { dbClient } = options;
    const generateTokensFn = options.generateTokens || generateJwtTokens;

    // Check if user exists
    const existingUser = await dbClient.user.findUnique({
      where: { username }
    });

    if (existingUser) {
      return {
        success: false,
        error: 'Username already taken'
      };
    }

    // Create user with pre-hashed password and pre-encrypted master key
    const user = await dbClient.user.create({
      data: {
        username,
        password_hash: passwordHash, // Already hashed on client
        master_key_encrypted: encryptedMasterKey, // Already encrypted on client
        master_key_salt: masterKeySalt
      }
    });

    logger.info(`E2E User registered: ${username}`);

    // Create default task list if provided (encrypted client-side)
    if (defaultTaskList && dbClient.taskList) {
      try {
        await dbClient.taskList.create({
          data: {
            id: defaultTaskList.id,
            user_id: user.id,
            name_encrypted: defaultTaskList.name_encrypted,
            is_default: true,
            order_index: 0
          }
        });
        logger.info(`Default task list created for user: ${username}`);
      } catch (listError) {
        // Non-fatal: safety net in Task app will create it on first sync
        logger.error('Failed to create default task list during registration:', listError);
      }
    }

    // Generate tokens for auto-login after registration
    const { accessToken, refreshToken } = await generateTokensFn(user.id);

    // Save refresh token to database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    await dbClient.refreshToken.create({
      data: {
        token: refreshToken,
        user_id: user.id,
        family_id: uuidv4(),
        expires_at: expiresAt
      }
    });

    // Prepare response
    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      created_at: user.created_at.toISOString(),
      updated_at: user.updated_at.toISOString()
    };

    return {
      success: true,
      data: {
        success: true,
        user: authUser,
        encryptedMasterKey,
        masterKeySalt,
        accessToken,
        refreshToken
      }
    };
  } catch (error) {
    logger.error('E2E Registration handler error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Registration failed'
    };
  }
}
