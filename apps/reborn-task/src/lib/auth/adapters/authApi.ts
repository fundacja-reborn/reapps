import type {
	IAuthApiClient,
	LoginResult,
	RegisterResult,
	TwoFactorVerificationResult
} from '@reborn/auth';
import { createLogger } from '@reborn/utils';
import { syncService } from '$lib/services/sync.service';

const logger = createLogger('AuthApiAdapter');

/**
 * API adapter for authentication operations
 */
export class AuthApiAdapter implements IAuthApiClient {
	constructor(private apiUrl: string = '/api') {}

	async login(username: string, password: string): Promise<LoginResult> {
		try {
			const response = await fetch(`${this.apiUrl}/auth/login`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ username, password })
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				return {
					success: false,
					message: data.error || 'Login failed'
				};
			}

			// Map API response to LoginResult
			const result: LoginResult = {
				success: true,
				user: data.data.user,
				accessToken: data.data.access_token,
				// refresh_token is managed exclusively via httpOnly cookie (set by server)
				encryptedMasterKey: data.data.encryptedMasterKey,
				masterKeySalt: data.data.masterKeySalt
			};

			// Check if 2FA is required
			if (data.data.twoFactorRequired) {
				result.twoFactorRequired = true;
				result.userId = data.data.userId;
			}

			// IMPORTANT: Set token in sync service immediately
			// This ensures the token is available when AuthService calls onStorageInit
			if (result.accessToken && !result.twoFactorRequired) {
				// Save to localStorage first
				localStorage.setItem('access_token', result.accessToken);
				// Note: refresh_token is managed exclusively via httpOnly cookie (set by server)
				// Then set in sync service
				syncService.setAuthToken(result.accessToken);
				logger.debug('Auth token set in sync service immediately after login API call');
			}

			return result;
		} catch (error: unknown) {
			logger.error('Login API error:', error);
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Network error'
			};
		}
	}

	async register(
		username: string,
		password: string,
		preferredLanguage?: string
	): Promise<RegisterResult> {
		try {
			const response = await fetch(`${this.apiUrl}/auth/register`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					username,
					password,
					preferred_language: preferredLanguage
				})
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				return {
					success: false,
					message: data.error || 'Registration failed'
				};
			}

			// Map API response to RegisterResult
			const result: RegisterResult = {
				success: true,
				user: data.data.user,
				accessToken: data.data.access_token,
				// refresh_token is managed exclusively via httpOnly cookie (set by server)
				encryptedMasterKey: data.data.encryptedMasterKey,
				masterKeySalt: data.data.masterKeySalt
			};

			// Set token in sync service immediately
			if (result.accessToken) {
				// Save to localStorage
				localStorage.setItem('access_token', result.accessToken);
				// Note: refresh_token is managed exclusively via httpOnly cookie (set by server)
				// Then set in sync service
				syncService.setAuthToken(result.accessToken);
				logger.debug('Auth token set in sync service immediately after register API call');
			}

			return result;
		} catch (error: unknown) {
			logger.error('Register API error:', error);
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Network error'
			};
		}
	}

	async logout(): Promise<void> {
		try {
			const accessToken = localStorage.getItem('access_token');
			const headers: Record<string, string> = {
				'Content-Type': 'application/json'
			};
			if (accessToken) {
				headers['Authorization'] = `Bearer ${accessToken}`;
			}

			await fetch(`${this.apiUrl}/auth/logout`, {
				method: 'POST',
				headers
			});
		} catch (error: unknown) {
			// Ignore logout errors
			logger.error('Logout API error:', error);
		}
	}

	async verifyTwoFactor(
		userId: string,
		code: string,
		password?: string
	): Promise<TwoFactorVerificationResult> {
		try {
			const response = await fetch(`${this.apiUrl}/auth/verify-2fa`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ userId, code, password })
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				return {
					success: false,
					message: data.error || '2FA verification failed'
				};
			}

			return {
				success: true,
				user: data.data.user
			};
		} catch (error: unknown) {
			logger.error('2FA verification API error:', error);
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Network error'
			};
		}
	}

	async refreshToken(_refreshToken?: string): Promise<LoginResult> {
		try {
			// Refresh token is sent automatically via httpOnly cookie.
			// The _refreshToken parameter is kept for interface compatibility but ignored.
			const response = await fetch(`${this.apiUrl}/auth/refresh`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({})
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				return {
					success: false,
					message: data.error || 'Token refresh failed'
				};
			}

			const result: LoginResult = {
				success: true,
				user: data.data.user,
				accessToken: data.data.access_token,
				// refresh_token is managed exclusively via httpOnly cookie (set by server)
				encryptedMasterKey: data.data.encryptedMasterKey,
				masterKeySalt: data.data.masterKeySalt
			};

			// Set token in sync service immediately
			if (result.accessToken) {
				// Save to localStorage
				localStorage.setItem('access_token', result.accessToken);
				// Note: refresh_token is managed exclusively via httpOnly cookie (set by server)
				// Then set in sync service
				syncService.setAuthToken(result.accessToken);
				logger.debug('Auth token set in sync service immediately after refresh API call');
			}

			return result;
		} catch (error: unknown) {
			logger.error('Token refresh API error:', error);
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Network error'
			};
		}
	}
}
