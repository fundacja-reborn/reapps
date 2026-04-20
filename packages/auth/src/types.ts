/**
 * Authentication types
 */

export interface AuthUser {
  id: string;
  username: string;
  created_at: string;
  updated_at: string;
  preferred_language?: string;
  preferred_date_format?: string;
  is_2fa_enabled?: boolean;
}

export interface AuthSession {
  isAuthenticated: boolean;
  isInitialized: boolean;
  hasE2E: boolean;
  user: AuthUser | null;
  error: string | null;
  isLoading: boolean;
  isLoggingOut: boolean;
}

export interface LoginResult {
  success: boolean;
  user?: AuthUser;
  encryptedMasterKey?: string;
  masterKeySalt?: string;
  accessToken?: string;
  refreshToken?: string;
  twoFactorRequired?: boolean;
  userId?: string;
  message?: string;
}

export interface TwoFactorVerificationResult {
  success: boolean;
  user?: AuthUser;
  message?: string;
}

export interface RegisterResult {
  success: boolean;
  user?: AuthUser;
  encryptedMasterKey?: string;
  masterKeySalt?: string;
  accessToken?: string;
  refreshToken?: string;
  message?: string;
}

export interface AuthCredentials {
  id: string;
  refreshToken?: string;
  encrypted_master_key: string;
  master_key_salt: string;
  user_profile: AuthUser;
}

export interface UserSettings {
  id: string;
  is_2fa_enabled: boolean;
  preferred_language: string;
  preferred_date_format: string;
}

// Auth API interfaces
export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  preferred_language?: string;
}

export interface TwoFactorVerifyRequest {
  userId: string;
  code: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

// Session management
export interface SessionManager {
  getCurrentSession(): AuthSession;
  setSession(session: AuthSession): void;
  clearSession(): void;
  isAuthenticated(): boolean;
  hasE2E(): boolean;
}

// Unlock E2E result
export interface UnlockE2EResult {
  success: boolean;
  username?: string;
  message?: string;
  attemptsRemaining?: number;
}

// Auth service interface
export interface IAuthService {
  login(username: string, password: string): Promise<LoginResult>;
  register(username: string, password: string, preferredLanguage?: string): Promise<RegisterResult>;
  logout(skipApiCall?: boolean): Promise<void>;
  verifyTwoFactor(userId: string, code: string): Promise<TwoFactorVerificationResult>;
  refreshToken(refreshToken?: string): Promise<LoginResult>;
  completeLogin(loginData: LoginResult, password: string): Promise<boolean>;
  finalize2FALogin(verificationData: TwoFactorVerificationResult): Promise<boolean>;
  unlockE2E(password: string): Promise<UnlockE2EResult>;
}

// Auth errors
export class AuthError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class TwoFactorRequiredError extends AuthError {
  constructor(
    public userId: string,
    public encryptedMasterKey: string,
    public masterKeySalt: string,
    public encrypted2FASecret: string
  ) {
    super('Two-factor authentication required', 'TWO_FACTOR_REQUIRED');
  }
}
