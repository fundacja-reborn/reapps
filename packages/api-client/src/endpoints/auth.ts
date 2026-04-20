import { ApiClient } from '../core/client';
import type { ApiResponse } from '../types';

/**
 * User credentials for login
 */
export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * User registration data
 */
export interface RegisterData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

/**
 * User profile data
 */
export interface UserProfile {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Auth response
 */
export interface AuthResponse {
  user: UserProfile;
  token?: string;
}

/**
 * Auth endpoints
 */
export class AuthEndpoints {
  constructor(private client: ApiClient) {}

  /**
   * Login user
   */
  async login(credentials: LoginCredentials): Promise<ApiResponse<AuthResponse>> {
    return this.client.post<AuthResponse>('/auth/login', credentials, {
      skipAuth: true
    });
  }

  /**
   * Register new user
   */
  async register(data: RegisterData): Promise<ApiResponse<AuthResponse>> {
    return this.client.post<AuthResponse>('/auth/register', data, {
      skipAuth: true
    });
  }

  /**
   * Logout current user
   */
  async logout(): Promise<ApiResponse<void>> {
    return this.client.post<void>('/auth/logout');
  }

  /**
   * Get current user profile
   */
  async getCurrentUser(): Promise<ApiResponse<UserProfile>> {
    return this.client.get<UserProfile>('/profile/current');
  }

  /**
   * Update user profile
   */
  async updateProfile(data: Partial<UserProfile>): Promise<ApiResponse<UserProfile>> {
    return this.client.put<UserProfile>('/profile', data);
  }

  /**
   * Change password
   */
  async changePassword(data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<ApiResponse<void>> {
    return this.client.post<void>('/auth/change-password', data);
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<ApiResponse<void>> {
    return this.client.post<void>(
      '/auth/reset-password',
      { email },
      {
        skipAuth: true
      }
    );
  }

  /**
   * Reset password with token
   */
  async resetPassword(data: { token: string; password: string }): Promise<ApiResponse<void>> {
    return this.client.post<void>('/auth/reset-password/confirm', data, {
      skipAuth: true
    });
  }

  /**
   * Verify email
   */
  async verifyEmail(token: string): Promise<ApiResponse<void>> {
    return this.client.post<void>(
      '/auth/verify-email',
      { token },
      {
        skipAuth: true
      }
    );
  }

  /**
   * Enable 2FA
   */
  async enable2FA(): Promise<
    ApiResponse<{
      secret: string;
      qrCode: string;
    }>
  > {
    return this.client.post('/auth/2fa/enable');
  }

  /**
   * Disable 2FA
   */
  async disable2FA(code: string): Promise<ApiResponse<void>> {
    return this.client.post<void>('/auth/2fa/disable', { code });
  }

  /**
   * Verify 2FA code
   */
  async verify2FA(code: string): Promise<ApiResponse<AuthResponse>> {
    return this.client.post<AuthResponse>('/auth/verify-2fa', { code });
  }

  /**
   * Generate recovery codes
   */
  async generateRecoveryCodes(): Promise<
    ApiResponse<{
      codes: string[];
    }>
  > {
    return this.client.post('/auth/generate-recovery-codes');
  }

  /**
   * Check if email exists
   */
  async checkEmail(email: string): Promise<ApiResponse<{ exists: boolean }>> {
    return this.client.post<{ exists: boolean }>(
      '/auth/check-email',
      { email },
      {
        skipAuth: true
      }
    );
  }

  /**
   * Refresh auth token
   */
  async refreshToken(): Promise<ApiResponse<{ token: string }>> {
    return this.client.post<{ token: string }>('/auth/refresh');
  }
}
