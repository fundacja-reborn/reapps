import type { 
  IAuthApiClient, 
  LoginResult, 
  RegisterResult, 
  TwoFactorVerificationResult 
} from '../services/AuthService';
import type { AuthUser } from '../types';

/**
 * Options for creating auth API client
 */
export interface AuthApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

/**
 * Create an auth API client for making HTTP requests
 */
export function createAuthApiClient(options: AuthApiClientOptions = {}): IAuthApiClient {
  const baseUrl = options.baseUrl || '';
  const fetchFn = options.fetch || fetch;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  const makeRequest = async (
    path: string,
    method = 'GET',
    body?: any
  ): Promise<any> => {
    const response = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers: defaultHeaders,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `Request failed with status ${response.status}`);
    }

    return data;
  };

  return {
    async login(username: string, password: string): Promise<LoginResult> {
      const data = await makeRequest('/api/auth/login', 'POST', { username, password });
      
      // Map response to LoginResult
      return {
        success: data.success || false,
        user: data.data ? mapToAuthUser(data.data) : undefined,
        encryptedMasterKey: data.user?.encrypted_master_key,
        masterKeySalt: data.user?.master_key_salt,
        refreshToken: data.refreshToken,
        twoFactorRequired: data.twoFactorRequired,
        userId: data.userId,
        message: data.message
      };
    },

    async register(username: string, password: string, preferredLanguage?: string): Promise<RegisterResult> {
      const data = await makeRequest('/api/auth/register', 'POST', {
        username,
        password,
        preferred_language: preferredLanguage
      });

      return {
        success: data.success || false,
        user: data.data ? mapToAuthUser(data.data) : undefined,
        encryptedMasterKey: data.user?.encrypted_master_key,
        masterKeySalt: data.user?.master_key_salt,
        message: data.message
      };
    },

    async logout(): Promise<void> {
      await makeRequest('/api/auth/logout', 'POST');
    },

    async verifyTwoFactor(userId: string, code: string): Promise<TwoFactorVerificationResult> {
      const data = await makeRequest('/api/auth/verify-2fa', 'POST', {
        userId,
        code
      });

      return {
        success: data.success || false,
        user: data.data ? mapToAuthUser(data.data) : undefined,
        message: data.message
      };
    },

    async refreshToken(refreshToken?: string): Promise<LoginResult> {
      const data = await makeRequest('/api/auth/refresh', 'POST', { refreshToken });

      return {
        success: data.success || false,
        user: data.data ? mapToAuthUser(data.data) : undefined,
        encryptedMasterKey: data.user?.encrypted_master_key,
        masterKeySalt: data.user?.master_key_salt,
        refreshToken: data.refreshToken,
        message: data.message
      };
    }
  };
}

/**
 * Map API response to AuthUser type
 */
function mapToAuthUser(data: any): AuthUser {
  return {
    id: data.id,
    username: data.username,
    created_at: data.created_at || new Date().toISOString(),
    updated_at: data.updated_at || new Date().toISOString(),
    preferred_language: data.preferred_language || data.preferredLanguage,
    preferred_date_format: data.preferred_date_format || data.preferredDateFormat,
    is_2fa_enabled: data.is_2fa_enabled ?? false
  };
}
