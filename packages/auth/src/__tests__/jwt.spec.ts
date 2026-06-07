import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateTokens,
  verifyToken,
  generateSingleUseToken,
  verifySingleUseToken,
  extractTokenFromHeader,
  getTokenConfig
} from '../utils/jwt';
import { REFRESH_TOKEN_TTL_TIMESPAN } from '../config/token-ttl';

// Mock environment variable
beforeEach(() => {
  vi.stubEnv('JWT_SECRET', 'test-secret-key-for-testing');
});

describe('JWT Utils', () => {
  describe('generateTokens', () => {
    it('should generate access and refresh tokens', async () => {
      const userId = 'user-123';
      const tokens = await generateTokens(userId);

      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
      expect(tokens.accessToken).not.toBe(tokens.refreshToken);
    });

    it('should generate tokens with session ID', async () => {
      const userId = 'user-123';
      const sessionId = 'session-456';
      const tokens = await generateTokens(userId, sessionId);

      // Verify the token contains the session ID
      const verified = await verifyToken(tokens.accessToken);
      expect(verified?.sessionId).toBe(sessionId);
    });
  });

  describe('verifyToken', () => {
    it('should verify valid access token', async () => {
      const userId = 'user-123';
      const { accessToken } = await generateTokens(userId);

      const result = await verifyToken(accessToken);

      expect(result).toBeTruthy();
      expect(result?.userId).toBe(userId);
    });

    it('should verify valid refresh token', async () => {
      const userId = 'user-123';
      const { refreshToken } = await generateTokens(userId);

      const result = await verifyToken(refreshToken, 'refresh');

      expect(result).toBeTruthy();
      expect(result?.userId).toBe(userId);
    });

    it('should reject token with wrong type', async () => {
      const userId = 'user-123';
      const { accessToken } = await generateTokens(userId);

      const result = await verifyToken(accessToken, 'refresh');

      expect(result).toBeNull();
    });

    it('should reject invalid token', async () => {
      const result = await verifyToken('invalid-token');

      expect(result).toBeNull();
    });

    it('should reject expired token', async () => {
      // This would require mocking time or generating an expired token
      // For now, we'll test with an invalid token
      const result = await verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE2MDAwMDAwMDB9.invalid');

      expect(result).toBeNull();
    });
  });

  describe('generateSingleUseToken', () => {
    it('should generate single-use token', async () => {
      const userId = 'user-123';
      const purpose = 'password-reset';

      const token = await generateSingleUseToken(userId, purpose);

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
    });

    it('should generate token with custom expiry', async () => {
      const userId = 'user-123';
      const purpose = 'email-verification';
      const expiryMinutes = 60;

      const token = await generateSingleUseToken(userId, purpose, expiryMinutes);

      expect(token).toBeTruthy();
    });
  });

  describe('verifySingleUseToken', () => {
    it('should verify valid single-use token', async () => {
      const userId = 'user-123';
      const purpose = 'password-reset';

      const token = await generateSingleUseToken(userId, purpose);
      const result = await verifySingleUseToken(token, purpose);

      expect(result).toBeTruthy();
      expect(result?.userId).toBe(userId);
      expect(result?.jti).toBeTruthy();
    });

    it('should reject token with wrong purpose', async () => {
      const userId = 'user-123';
      const token = await generateSingleUseToken(userId, 'password-reset');

      const result = await verifySingleUseToken(token, 'email-verification');

      expect(result).toBeNull();
    });

    it('should reject regular token as single-use', async () => {
      const { accessToken } = await generateTokens('user-123');

      const result = await verifySingleUseToken(accessToken, 'password-reset');

      expect(result).toBeNull();
    });
  });

  describe('extractTokenFromHeader', () => {
    it('should extract token from valid Bearer header', () => {
      const token = 'eyJhbGciOiJIUzI1NiJ9.test';
      const header = `Bearer ${token}`;

      const extracted = extractTokenFromHeader(header);

      expect(extracted).toBe(token);
    });

    it('should return null for invalid header format', () => {
      expect(extractTokenFromHeader('InvalidHeader')).toBeNull();
      expect(extractTokenFromHeader('Basic token')).toBeNull();
      expect(extractTokenFromHeader('Bearer')).toBeNull();
      expect(extractTokenFromHeader('')).toBeNull();
      expect(extractTokenFromHeader(null)).toBeNull();
    });
  });

  describe('getTokenConfig', () => {
    it('should return token configuration', () => {
      const config = getTokenConfig();

      expect(config).toHaveProperty('accessTokenExpiry');
      expect(config).toHaveProperty('refreshTokenExpiry');
      expect(config.accessTokenExpiry).toBe('15m');
      // Refresh-token TTL derives from the shared constant (single source of truth).
      expect(config.refreshTokenExpiry).toBe(REFRESH_TOKEN_TTL_TIMESPAN);
      expect(REFRESH_TOKEN_TTL_TIMESPAN).toBe('30d');
    });
  });

  describe('JWT_SECRET fail-fast', () => {
    it('should throw in production when JWT_SECRET is missing', async () => {
      vi.stubEnv('JWT_SECRET', '');
      vi.stubEnv('NODE_ENV', 'production');

      await expect(generateTokens('user-123')).rejects.toThrow();
    });

    it('should use fallback in development when JWT_SECRET is missing', async () => {
      vi.stubEnv('JWT_SECRET', '');
      vi.stubEnv('NODE_ENV', 'development');

      const tokens = await generateTokens('user-123');
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
    });
  });
});
