/**
 * Framework-agnostic API handlers for authentication
 * These handlers can be used in any server framework (SvelteKit, Express, etc.)
 */

import { createLogger } from '@reborn/utils';
import { schemas } from '@reborn/types';
import {
  hashPassword,
  verifyPassword,
  generateMasterKeyForUser,
  isValidPBKDF2Hash
} from '@reborn/crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  generateTokens as generateJwtTokens,
  verifyToken as verifyJwtToken,
  blacklistAccessToken
} from '../utils/jwt';
import { refreshTokenExpiryDate } from '../config/token-ttl';
import type { LoginResult, RegisterResult, AuthUser } from '../types';

const logger = createLogger('AuthAPIHandlers');

// Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// Handler options - with optional functions that have defaults
export interface HandlerOptions {
  dbClient: {
    user: {
      findUnique: (args: any) => Promise<any>;
      create: (args: any) => Promise<any>;
      update: (args: any) => Promise<any>;
    };
    refreshToken: {
      findUnique: (args: any) => Promise<any>;
      findMany: (args: any) => Promise<any[]>;
      create: (args: any) => Promise<any>;
      delete: (args: any) => Promise<any>;
      deleteMany: (args: any) => Promise<any>;
      updateMany: (args: any) => Promise<any>;
    };
    taskList?: {
      create: (args: any) => Promise<any>;
    };
  }; // Abstract database client (Prisma, etc.)
  // Optional functions - will use internal implementations if not provided
  hashPassword?: (password: string) => Promise<string>;
  verifyPassword?: (password: string, hash: string) => Promise<boolean>;
  generateTokens?: (userId: string) => Promise<{ accessToken: string; refreshToken: string }>;
  verifyToken?: (token: string) => Promise<{ userId: string } | null>;
  generateEncryptionKey?: (
    password: string
  ) => Promise<{ encryptedMasterKey: string; masterKeySalt: string }>;
}

/**
 * Create default handler options with all internal implementations
 */
export function createDefaultHandlerOptions(
  dbClient: HandlerOptions['dbClient']
): Required<HandlerOptions> {
  return {
    dbClient,
    hashPassword,
    verifyPassword,
    generateTokens: generateJwtTokens,
    // Access tokens only: refresh JWTs verify with the same secret but must
    // not authenticate session/data reads (they bypass rotation + revocation).
    verifyToken: (token: string) => verifyJwtToken(token, 'access'),
    generateEncryptionKey: async (password: string) => {
      const result = await generateMasterKeyForUser(password);
      return {
        encryptedMasterKey: result.encryptedMasterKey,
        masterKeySalt: result.salt
      };
    }
  };
}

/**
 * Handle user registration
 */
export async function handleRegister(
  data: unknown,
  options: HandlerOptions
): Promise<ApiResponse<RegisterResult>> {
  try {
    // Validate input
    const validationResult = schemas.RegisterRequestSchema.safeParse(data);
    if (!validationResult.success) {
      return {
        success: false,
        error: 'Invalid registration data'
      };
    }

    const { username, password, preferred_language = 'en' } = validationResult.data;
    const { dbClient } = options;
    const hashPasswordFn = options.hashPassword || hashPassword;
    const generateEncryptionKeyFn =
      options.generateEncryptionKey ||
      (async (pwd: string) => {
        const result = await generateMasterKeyForUser(pwd);
        return {
          encryptedMasterKey: result.encryptedMasterKey,
          masterKeySalt: result.salt
        };
      });

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

    // Hash password
    const passwordHash = await hashPasswordFn(password);

    // Generate encryption keys
    const { encryptedMasterKey, masterKeySalt } = await generateEncryptionKeyFn(password);

    // Create user
    const user = await dbClient.user.create({
      data: {
        username,
        password_hash: passwordHash,
        master_key_encrypted: encryptedMasterKey,
        master_key_salt: masterKeySalt
      }
    });

    logger.info(`User registered: ${username}`);

    // Generate tokens for auto-login after registration
    const generateTokensFn = options.generateTokens || generateJwtTokens;
    const { accessToken, refreshToken } = await generateTokensFn(user.id);

    // Save refresh token to database with a new token family
    const expiresAt = refreshTokenExpiryDate();

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
    logger.error('Registration handler error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Registration failed'
    };
  }
}

/**
 * Handle user login
 */
export async function handleLogin(
  data: unknown,
  options: HandlerOptions
): Promise<ApiResponse<LoginResult>> {
  try {
    // Validate input
    const validationResult = schemas.LoginRequestSchema.safeParse(data);
    if (!validationResult.success) {
      return {
        success: false,
        error: 'Invalid login data'
      };
    }

    const { username, password } = validationResult.data;
    const { dbClient } = options;
    const verifyPasswordFn = options.verifyPassword || verifyPassword;
    const generateTokensFn = options.generateTokens || generateJwtTokens;

    // Find user
    const user = await dbClient.user.findUnique({
      where: { username }
    });

    if (!user) {
      return {
        success: false,
        error: 'Invalid credentials'
      };
    }

    // Verify password
    const isValidPassword = await verifyPasswordFn(password, user.password_hash);
    if (!isValidPassword) {
      return {
        success: false,
        error: 'Invalid credentials'
      };
    }

    // Re-hash legacy PBKDF2 hashes to Argon2id transparently
    if (isValidPBKDF2Hash(user.password_hash)) {
      try {
        const hashPasswordFn = options.hashPassword || hashPassword;
        const newHash = await hashPasswordFn(password);
        await dbClient.user.update({
          where: { id: user.id },
          data: { password_hash: newHash }
        });
        logger.info(`Re-hashed PBKDF2 password to Argon2id for user: ${username}`);
      } catch (rehashError) {
        // Non-fatal: login still succeeds, re-hash will be retried next login
        logger.warn('Failed to re-hash password to Argon2id:', rehashError);
      }
    }

    // Check if 2FA is enabled
    // Note: 2FA verification is handled in app-level route handlers
    // (each app queries `prisma.twoFactorAuth` and validates TOTP/recovery codes there).
    // This package-level handler intentionally does NOT enforce 2FA — keep `false`.
    const is2FAEnabled = false;

    if (is2FAEnabled) {
      // Return partial data for 2FA flow
      return {
        success: true,
        data: {
          success: true,
          twoFactorRequired: true,
          userId: user.id,
          encryptedMasterKey: user.master_key_encrypted,
          masterKeySalt: user.master_key_salt
        }
      };
    }

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokensFn(user.id);

    // Save refresh token to database with a new token family
    const expiresAt = refreshTokenExpiryDate();

    await dbClient.refreshToken.create({
      data: {
        token: refreshToken,
        user_id: user.id,
        family_id: uuidv4(),
        expires_at: expiresAt
      }
    });

    // Update last login
    await dbClient.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() }
    });

    logger.info(`User logged in: ${username}`);

    // Prepare response
    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      created_at: user.created_at.toISOString(),
      updated_at: user.updated_at.toISOString()
      // Note: preferred_language and preferred_date_format are stored in settings_encrypted
    };

    return {
      success: true,
      data: {
        success: true,
        user: authUser,
        encryptedMasterKey: user.master_key_encrypted,
        masterKeySalt: user.master_key_salt,
        accessToken,
        refreshToken
      }
    };
  } catch (error) {
    logger.error('Login handler error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Login failed'
    };
  }
}

/**
 * Handle user logout
 */
export async function handleLogout(
  userId: string | undefined,
  options: HandlerOptions,
  accessToken?: string
): Promise<ApiResponse<void>> {
  try {
    if (!userId) {
      return {
        success: false,
        error: 'User not authenticated'
      };
    }

    const { dbClient } = options;

    // Blacklist the access token so it's rejected immediately
    if (accessToken) {
      await blacklistAccessToken(accessToken);
    }

    // Optional: Invalidate refresh tokens
    await dbClient.refreshToken.deleteMany({
      where: { user_id: userId }
    });

    logger.info(`User logged out: ${userId}`);

    return {
      success: true
    };
  } catch (error) {
    logger.error('Logout handler error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Logout failed'
    };
  }
}

/**
 * Handle session check
 */
export async function handleSession(
  token: string | undefined,
  options: HandlerOptions
): Promise<ApiResponse<AuthUser>> {
  try {
    if (!token) {
      return {
        success: false,
        error: 'No token provided'
      };
    }

    const { dbClient } = options;
    const verifyTokenFn =
      options.verifyToken || ((token: string) => verifyJwtToken(token, 'access'));

    // Verify token
    const tokenData = await verifyTokenFn(token);
    if (!tokenData) {
      return {
        success: false,
        error: 'Invalid token'
      };
    }

    // Get user data
    const user = await dbClient.user.findUnique({
      where: { id: tokenData.userId }
    });

    if (!user) {
      return {
        success: false,
        error: 'User not found'
      };
    }

    // Prepare response
    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      created_at: user.created_at.toISOString(),
      updated_at: user.updated_at.toISOString()
      // Note: preferred_language and preferred_date_format are stored in settings_encrypted
    };

    return {
      success: true,
      data: authUser
    };
  } catch (error) {
    logger.error('Session handler error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Session check failed'
    };
  }
}

/**
 * Handle refresh token
 *
 * Implements token family tracking (S3):
 * - Each login creates a new "family" of tokens (family_id)
 * - On refresh, the old token is marked as revoked and a new one is created in the same family
 * - If a revoked token is presented again → the entire family is invalidated (potential theft)
 *
 * Error classification: this handler intentionally does **not** wrap the body in
 * a try/catch. Auth-level failures (validation, missing/revoked/expired token)
 * resolve with `{ success: false, error }` and the route maps them to 401 -
 * client classifies as definitive expiry → session-expired banner. Infrastructure
 * failures (Prisma cold-start, DB connection drop, JWT signing error) propagate
 * up to the route's outer try/catch which returns 500 - client classifies as
 * transient (`TransientRefreshError`) and stays in offline mode without flashing
 * the banner. See `docs/development/planning/session-expiry-server-rebuild-resilience.md`.
 */
export async function handleRefreshToken(
  data: unknown,
  options: HandlerOptions
): Promise<ApiResponse<LoginResult>> {
  // Validate input - definitive auth failure (Zod rejects malformed body).
  const validationResult = schemas.RefreshTokenRequestSchema.safeParse(data);
  if (!validationResult.success) {
    return {
      success: false,
      error: 'Invalid refresh token data'
    };
  }

  const { refresh_token: refreshToken } = validationResult.data;
  const { dbClient } = options;
  const generateTokensFn = options.generateTokens || generateJwtTokens;

  // Find refresh token (include user for response data).
  // Prisma errors here (cold-start pool, ECONNREFUSED, etc.) propagate.
  const storedToken = await dbClient.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true }
  });

  if (!storedToken) {
    return {
      success: false,
      error: 'Invalid or expired refresh token'
    };
  }

  // TOKEN REUSE DETECTION: If this token was already revoked (used before),
  // it means someone is replaying a stolen token → invalidate the entire family
  if (storedToken.is_revoked) {
    logger.warn(
      `Refresh token reuse detected! Revoking entire token family: ${storedToken.family_id}, user: ${storedToken.user_id}`
    );

    // Revoke all tokens in this family
    await dbClient.refreshToken.deleteMany({
      where: { family_id: storedToken.family_id }
    });

    return {
      success: false,
      error: 'Token reuse detected. Please log in again.'
    };
  }

  // Check expiry
  if (storedToken.expires_at < new Date()) {
    return {
      success: false,
      error: 'Invalid or expired refresh token'
    };
  }

  // Generate new tokens. JWT signing errors propagate as 5xx.
  const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await generateTokensFn(
    storedToken.user_id
  );

  // Mark old token as revoked (not deleted — needed for reuse detection).
  // Best-effort: a failure to flip is_revoked is non-fatal for the current
  // refresh (the new token is already issued); next reuse check still has the
  // family. Keep as warning, not as auth failure.
  try {
    await dbClient.refreshToken.updateMany({
      where: { id: storedToken.id },
      data: { is_revoked: true }
    });
  } catch (updateError: unknown) {
    logger.warn('Failed to revoke old refresh token:', updateError);
  }

  // Save new refresh token in the same family, preserving session link
  const expiresAt = refreshTokenExpiryDate();

  await dbClient.refreshToken.create({
    data: {
      token: newRefreshToken,
      user_id: storedToken.user_id,
      family_id: storedToken.family_id,
      expires_at: expiresAt,
      session_id: storedToken.session_id ?? undefined
    }
  });

  const user = storedToken.user;
  logger.info(`Token refreshed for user: ${user.username}`);

  // Cleanup: delete expired revoked tokens to prevent table bloat (non-blocking)
  dbClient.refreshToken
    .deleteMany({
      where: {
        user_id: storedToken.user_id,
        is_revoked: true,
        expires_at: { lt: new Date() }
      }
    })
    .catch((err: unknown) => logger.debug('Revoked token cleanup failed:', err));

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
      encryptedMasterKey: user.master_key_encrypted,
      masterKeySalt: user.master_key_salt,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    }
  };
}

