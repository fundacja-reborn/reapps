/**
 * @reborn/auth/server - Server-only exports for Reborn Apps
 *
 * This module contains exports that depend on Node.js APIs (e.g. crypto.createHmac)
 * and must NOT be imported in client/browser code.
 *
 * Import path: `@reborn/auth/server`
 */

// JWT utilities (isomorphic but only used server-side)
export {
  generateTokens,
  verifyToken,
  generateSingleUseToken,
  verifySingleUseToken,
  consumeSingleUseToken,
  extractTokenFromHeader,
  getTokenConfig,
  blacklistAccessToken,
  TWO_FACTOR_CHALLENGE_PURPOSE,
  TWO_FACTOR_CHALLENGE_TTL_MINUTES
} from './utils/jwt';
export type { TokenPair, TokenPayload } from './utils/jwt';

// Refresh-token lifetime - single source of truth for session longevity.
// Used by route handlers to set cookie `maxAge` and DB `expires_at` consistently.
export {
  REFRESH_TOKEN_TTL_DAYS,
  REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_TIMESPAN,
  refreshTokenExpiryDate
} from './config/token-ttl';

// Token blacklist utilities (server-side only)
export { isTokenBlacklisted, getBlacklistSize, clearBlacklist } from './utils/tokenBlacklist';

// API handlers (server-side request handlers)
export {
  handleRegister,
  handleLogin,
  handleLogout,
  handleSession,
  handleRefreshToken,
  createDefaultHandlerOptions
} from './api/handlers';
export type { ApiResponse, HandlerOptions } from './api/handlers';

// E2E handlers
export { handleE2ERegister } from './api/e2eHandlers';

// E2E synced user settings handlers
export {
  handleGetSettings,
  handleUpdateSettings,
  SCOPE_SHARED
} from './api/settings-handlers';
export type {
  AppScope,
  SettingsScope,
  SettingsBundleRow,
  SettingsGetResponse,
  SettingsDbClient,
  SettingsHandlerResult
} from './api/settings-handlers';

// PoW (Proof-of-Work) — server-side (uses Node.js crypto.createHmac)
export {
  generatePowChallenge,
  signChallenge,
  verifySignedChallenge,
  verifyPowSolution
} from './utils/pow';
export type { PowChallenge, SignedPowChallenge } from './utils/pow';

// Middleware (server-side request processing)
export {
  createAuthMiddleware,
  createCorsMiddleware,
  createRateLimitMiddleware,
  combineMiddleware,
  MemoryRateLimitStore
} from './middleware/authMiddleware';
export type {
  ApiRequest,
  ApiResponse as ApiMiddlewareResponse,
  ApiContext,
  AuthMiddlewareOptions,
  CorsOptions,
  RateLimitOptions,
  RateLimitStore
} from './middleware/authMiddleware';
