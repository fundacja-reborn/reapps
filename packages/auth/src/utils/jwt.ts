/**
 * JWT utilities for authentication
 * Provides token generation and verification for Zero Knowledge architecture
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createLogger } from '@reborn/utils';
import { v4 as uuidv4 } from 'uuid';
import { isTokenBlacklisted, blacklistToken } from './tokenBlacklist';
import { REFRESH_TOKEN_TTL_TIMESPAN } from '../config/token-ttl';

const logger = createLogger('JWTUtils');

// JWT configuration.
// `refreshTokenExpiry` derives from the shared refresh-token TTL (see
// ../config/token-ttl). Note this JWT `exp` is cosmetic for the refresh flow -
// `handleRefreshToken` never verifies the refresh token as a JWT - but we keep
// it in sync so the access/refresh timing config stays coherent.
const JWT_CONFIG = {
  accessTokenExpiry: '15m',
  refreshTokenExpiry: REFRESH_TOKEN_TTL_TIMESPAN,
  issuer: 'reborn-apps',
  audience: 'reborn-users'
};

// Get JWT secret from environment — fail-fast in production
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      throw new Error(
        'FATAL: JWT_SECRET environment variable is not set in production. ' +
          'Refusing to start with insecure defaults.'
      );
    }
    logger.warn(
      'JWT_SECRET not set — using development fallback. ' + 'Set JWT_SECRET in production!'
    );
    return new TextEncoder().encode('development-secret-change-in-production');
  }

  return new TextEncoder().encode(secret);
}

/**
 * Get previous JWT secret for graceful key rotation.
 * During rotation, set JWT_SECRET to the new key and JWT_SECRET_PREVIOUS to the old key.
 * Tokens signed with the old key will remain valid until they expire naturally.
 * Remove JWT_SECRET_PREVIOUS after the grace period (max token TTL = 7 days for refresh tokens).
 *
 * @see docs/security/jwt-secret-rotation.md
 */
function getPreviousJwtSecret(): Uint8Array | null {
  const secret = process.env.JWT_SECRET_PREVIOUS;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// 2FA challenge token (audit 012 S4): issued by /login after the password step
// when 2FA is enabled, required by /2fa/verify instead of a raw userId - so the
// second factor cannot be attempted without first proving password knowledge.
export const TWO_FACTOR_CHALLENGE_PURPOSE = '2fa_challenge';
export const TWO_FACTOR_CHALLENGE_TTL_MINUTES = 5;

export interface TokenPayload extends JWTPayload {
  userId: string;
  tokenType: 'access' | 'refresh';
  sessionId?: string;
}

/**
 * Generate access and refresh tokens for a user
 * @param userId - User ID to include in token
 * @param sessionId - Optional session ID for token tracking
 * @returns Promise<TokenPair> - Access and refresh tokens
 */
export async function generateTokens(userId: string, sessionId?: string): Promise<TokenPair> {
  try {
    const secret = getJwtSecret();
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);

    // Debug logging for timestamp issues
    logger.debug('Token generation timestamps:', {
      nowMs,
      nowSeconds: now,
      dateString: new Date(nowMs).toISOString(),
      expectedExpiry: new Date((now + 900) * 1000).toISOString() // 15 minutes
    });

    // Generate access token
    const accessToken = await new SignJWT({
      userId,
      tokenType: 'access',
      sessionId: sessionId || uuidv4()
    } as TokenPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt() // Use default (current time) - jose will handle this correctly
      .setIssuer(JWT_CONFIG.issuer)
      .setAudience(JWT_CONFIG.audience)
      .setExpirationTime(JWT_CONFIG.accessTokenExpiry)
      .setJti(uuidv4())
      .sign(secret);

    // Generate refresh token
    const refreshToken = await new SignJWT({
      userId,
      tokenType: 'refresh',
      sessionId: sessionId || uuidv4()
    } as TokenPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt() // Use default (current time) - jose will handle this correctly
      .setIssuer(JWT_CONFIG.issuer)
      .setAudience(JWT_CONFIG.audience)
      .setExpirationTime(JWT_CONFIG.refreshTokenExpiry)
      .setJti(uuidv4())
      .sign(secret);

    logger.debug('Generated token pair for user:', userId);
    return { accessToken, refreshToken };
  } catch (error) {
    logger.error('Token generation failed:', error);
    throw new Error('Failed to generate tokens', { cause: error });
  }
}

/**
 * Verify a JWT token
 * @param token - JWT token to verify
 * @param expectedType - Expected token type (access or refresh)
 * @returns Promise<{userId: string} | null> - User ID if valid, null otherwise
 */
export async function verifyToken(
  token: string,
  expectedType?: 'access' | 'refresh'
): Promise<{ userId: string; sessionId?: string } | null> {
  try {
    const secret = getJwtSecret();
    const verifyOptions = {
      issuer: JWT_CONFIG.issuer,
      audience: JWT_CONFIG.audience
    };

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, secret, verifyOptions));
    } catch (primaryError) {
      // If current secret fails, try the previous secret (rotation grace period)
      const previousSecret = getPreviousJwtSecret();
      if (!previousSecret) throw primaryError;

      ({ payload } = await jwtVerify(token, previousSecret, verifyOptions));
      logger.info('Token verified with previous JWT secret (rotation in progress)');
    }

    // Debug logging for timestamp issues
    logger.debug('Token verification - payload timestamps:', {
      iat: payload.iat,
      exp: payload.exp,
      iatDate: payload.iat ? new Date(payload.iat * 1000).toISOString() : 'undefined',
      expDate: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'undefined',
      currentTime: new Date().toISOString()
    });

    const tokenPayload = payload as TokenPayload;

    // Check if token has been blacklisted (revoked on logout)
    if (payload.jti && isTokenBlacklisted(payload.jti)) {
      logger.debug('Token is blacklisted:', { jti: payload.jti });
      return null;
    }

    // Verify token type if specified
    if (expectedType && tokenPayload.tokenType !== expectedType) {
      logger.warn('Token type mismatch:', {
        expected: expectedType,
        actual: tokenPayload.tokenType
      });
      return null;
    }

    // Ensure userId is present
    if (!tokenPayload.userId) {
      logger.warn('Token missing userId');
      return null;
    }

    logger.debug('Token verified successfully');
    return {
      userId: tokenPayload.userId,
      sessionId: tokenPayload.sessionId
    };
  } catch (error) {
    logger.debug('Token verification failed:', error);
    return null;
  }
}

/**
 * Generate a single-use token for specific purposes (e.g., password reset)
 * @param userId - User ID
 * @param purpose - Token purpose
 * @param expiryMinutes - Token expiry in minutes (default: 30)
 * @returns Promise<string> - Single-use token
 */
export async function generateSingleUseToken(
  userId: string,
  purpose: string,
  expiryMinutes = 30
): Promise<string> {
  try {
    const secret = getJwtSecret();

    const token = await new SignJWT({
      userId,
      purpose,
      singleUse: true
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt() // Use default (current time)
      .setIssuer(JWT_CONFIG.issuer)
      .setExpirationTime(`${expiryMinutes}m`)
      .setJti(uuidv4())
      .sign(secret);

    logger.debug('Generated single-use token for purpose:', purpose);
    return token;
  } catch (error) {
    logger.error('Single-use token generation failed:', error);
    throw new Error('Failed to generate single-use token', { cause: error });
  }
}

/**
 * Verify a single-use token
 * @param token - Token to verify
 * @param expectedPurpose - Expected token purpose
 * @returns Promise<{userId, jti, expiresAt} | null> - Token identity if valid
 *          and not yet consumed. Pass `jti` + `expiresAt` to
 *          {@link consumeSingleUseToken} once the token has served its purpose.
 */
export async function verifySingleUseToken(
  token: string,
  expectedPurpose: string
): Promise<{ userId: string; jti: string; expiresAt: number } | null> {
  try {
    const secret = getJwtSecret();
    const verifyOptions = { issuer: JWT_CONFIG.issuer };

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, secret, verifyOptions));
    } catch (primaryError) {
      const previousSecret = getPreviousJwtSecret();
      if (!previousSecret) throw primaryError;
      ({ payload } = await jwtVerify(token, previousSecret, verifyOptions));
    }

    // Verify it's a single-use token
    if (!payload.singleUse || payload.purpose !== expectedPurpose) {
      logger.warn('Invalid single-use token');
      return null;
    }

    // Ensure required fields are present
    if (
      !payload.userId ||
      typeof payload.userId !== 'string' ||
      !payload.jti ||
      typeof payload.exp !== 'number'
    ) {
      logger.warn('Single-use token missing required fields');
      return null;
    }

    // Reject tokens already consumed via consumeSingleUseToken
    if (isTokenBlacklisted(payload.jti)) {
      logger.debug('Single-use token already consumed:', { jti: payload.jti });
      return null;
    }

    logger.debug('Single-use token verified successfully');
    return {
      userId: payload.userId as string,
      jti: payload.jti,
      expiresAt: payload.exp
    };
  } catch (error) {
    logger.debug('Single-use token verification failed:', error);
    return null;
  }
}

/**
 * Consume a single-use token: blacklist its jti until the token's natural
 * expiry, so every subsequent verifySingleUseToken() for it returns null.
 * Call only AFTER the action the token authorizes has succeeded - a failed
 * attempt keeps the token valid for a retry within its TTL.
 * @param jti - Token ID from verifySingleUseToken
 * @param expiresAt - Token expiry (seconds since epoch) from verifySingleUseToken
 */
export function consumeSingleUseToken(jti: string, expiresAt: number): void {
  blacklistToken(jti, expiresAt);
}

/**
 * Extract token from Authorization header
 * @param authHeader - Authorization header value
 * @returns string | null - Token if present and valid format
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    logger.debug('Invalid Authorization header format');
    return null;
  }

  return parts[1];
}

/**
 * Get token configuration
 * Useful for client-side token refresh timing
 */
export function getTokenConfig() {
  return {
    accessTokenExpiry: JWT_CONFIG.accessTokenExpiry,
    refreshTokenExpiry: JWT_CONFIG.refreshTokenExpiry
  };
}

/**
 * Blacklist an access token so it's rejected by verifyToken until it expires.
 * Called during logout to immediately invalidate the user's current access token.
 * @param token - Raw JWT access token string
 */
export async function blacklistAccessToken(token: string): Promise<void> {
  try {
    const secret = getJwtSecret();
    const verifyOptions = {
      issuer: JWT_CONFIG.issuer,
      audience: JWT_CONFIG.audience
    };

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, secret, verifyOptions));
    } catch (primaryError) {
      const previousSecret = getPreviousJwtSecret();
      if (!previousSecret) throw primaryError;
      ({ payload } = await jwtVerify(token, previousSecret, verifyOptions));
    }

    if (payload.jti && payload.exp) {
      blacklistToken(payload.jti, payload.exp);
      logger.debug('Access token blacklisted on logout', { jti: payload.jti });
    } else {
      logger.warn('Cannot blacklist token: missing jti or exp');
    }
  } catch (error) {
    // Token may already be expired or invalid — that's fine during logout
    logger.debug('Could not blacklist token (may be expired):', error);
  }
}
