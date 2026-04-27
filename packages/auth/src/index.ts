/**
 * @reborn/auth - Authentication package for Reborn Apps
 *
 * This package provides framework-agnostic authentication services
 * with support for E2E encryption
 */

// Export types
export * from './types';

// Export services
export { AuthService } from './services/AuthService';
export type { IAuthStorage, IAuthApiClient } from './services/AuthService';

export { SessionManager, sessionManager } from './services/SessionManager';

// Export utilities
export { createAuthApiClient } from './utils/authApiClient';
export { createAuthStorage } from './utils/authStorage';

// Re-export commonly used types for convenience
export type {
  AuthUser,
  AuthSession,
  LoginResult,
  RegisterResult,
  AuthCredentials,
  UserSettings,
  IAuthService,
  SessionManager as ISessionManager,
  UnlockE2EResult
} from './types';

// Export PoW solver — client-side (Web Crypto API)
export { solvePowChallenge } from './utils/pow-solver';
export type { PowChallengeData } from './utils/pow-solver';

// Cross-tab/cross-app refresh-token coordination
export { withRefreshLock } from './utils/refresh-lock';

// Authenticated fetch wrapper with single-flight 401 refresh + retry
export { createAuthFetch } from './utils/auth-fetch';
export type { AuthFetch, AuthFetchConfig, AuthFetchTokenStorage } from './utils/auth-fetch';

// Export guards
export {
  createAuthGuard,
  createRouteMatcher,
  combineGuards,
  createRoleGuard
} from './guards/authGuard';
export type { AuthGuardOptions, RouteContext, RoleGuardOptions } from './guards/authGuard';

// Export session store
export { createSessionStore, createDerivedStores, checkAuth } from './guards/sessionStore';
export type { ReactiveStore, SessionStore, DerivedStores } from './guards/sessionStore';

// Server-only exports (JWT, handlers, PoW, middleware) are in './server.ts'
// Import them via '@reborn/auth/server' in +server.ts and hooks.server.ts files
