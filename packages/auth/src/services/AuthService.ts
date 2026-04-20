import { createLogger } from '@reborn/utils';
import type { CryptoManager } from '@reborn/crypto';
import type {
  IAuthService,
  LoginResult,
  RegisterResult,
  TwoFactorVerificationResult,
  AuthUser,
  AuthCredentials,
  UserSettings,
  UnlockE2EResult
} from '../types';
import { SessionManager } from './SessionManager';

const logger = createLogger('AuthService');

/**
 * Storage interface for auth data
 */
export interface IAuthStorage {
  getCredentials(): Promise<AuthCredentials | null>;
  saveCredentials(credentials: AuthCredentials): Promise<void>;
  clearCredentials(): Promise<void>;
  getUserSettings(): Promise<UserSettings | null>;
  saveUserSettings(settings: UserSettings): Promise<void>;
}

/**
 * API client interface for auth operations
 */
export interface IAuthApiClient {
  login(username: string, password: string): Promise<LoginResult>;
  register(username: string, password: string, preferredLanguage?: string): Promise<RegisterResult>;
  logout(): Promise<void>;
  verifyTwoFactor(userId: string, code: string, password?: string): Promise<TwoFactorVerificationResult>;
  refreshToken(refreshToken?: string): Promise<LoginResult>;
}

// Re-export types for convenience
export type { LoginResult, RegisterResult, TwoFactorVerificationResult } from '../types';

/**
 * Framework-agnostic authentication service
 * Handles user authentication, registration, and session management
 */
export class AuthService implements IAuthService {
  private unlockAttempts = 0;
  private readonly MAX_UNLOCK_ATTEMPTS = 5;

  constructor(
    private cryptoManager: CryptoManager,
    private sessionManager: SessionManager,
    private storage: IAuthStorage,
    private apiClient: IAuthApiClient,
    private onStorageInit?: (
      cryptoManager: CryptoManager,
      context: 'login' | 'restore'
    ) => Promise<void>,
    private onLanguageChange?: (language: string) => void
  ) {}

  /**
   * Login user
   */
  async login(username: string, password: string): Promise<LoginResult> {
    this.sessionManager.setLoading(true);
    this.sessionManager.setError(null);

    try {
      // Reset state before login
      await this.resetAuthState();
      
      logger.debug(`Attempting to log in user: ${username}`);

      // Call login API
      const loginResult = await this.apiClient.login(username, password);

      if (!loginResult.success) {
        throw new Error(loginResult.message || 'Login failed');
      }

      // Handle 2FA requirement
      if (loginResult.twoFactorRequired) {
        logger.debug('Login requires 2FA verification');
        
        if (!loginResult.userId || !loginResult.encryptedMasterKey || 
            !loginResult.masterKeySalt) {
          throw new Error('Incomplete data received for 2FA step');
        }

        // Save interim credentials for 2FA verification
        await this.storage.saveCredentials({
          id: 'currentUser',
          refreshToken: 'pending-2fa-' + Date.now(),
          encrypted_master_key: loginResult.encryptedMasterKey,
          master_key_salt: loginResult.masterKeySalt,
          user_profile: {
            id: loginResult.userId,
            username: username,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        });

        this.sessionManager.setLoading(false);
        return loginResult;
      }

      // Complete standard login
      const loginCompleted = await this.completeLogin(loginResult, password);
      
      if (!loginCompleted) {
        throw new Error('Failed to complete login');
      }

      // Reset unlock attempts on successful login
      this.unlockAttempts = 0;

      return loginResult;
    } catch (error) {
      logger.error('Login failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      this.sessionManager.setError(errorMessage);
      
      // Don't initialize storage after failed login
      // Storage should only be initialized after successful authentication

      throw error;
    }
  }

  /**
   * Register new user
   */
  async register(username: string, password: string, preferredLanguage = 'en'): Promise<RegisterResult> {
    this.sessionManager.setLoading(true);
    this.sessionManager.setError(null);

    try {
      const registerResult = await this.apiClient.register(username, password, preferredLanguage);

      if (!registerResult.success) {
        throw new Error(registerResult.message || 'Registration failed');
      }

      // If we have encryption keys, load them
      if (registerResult.encryptedMasterKey && registerResult.masterKeySalt) {
        logger.debug('Loading encryption key after registration');
        
        const keyLoaded = await this.cryptoManager.loadUserMasterKey(
          registerResult.encryptedMasterKey,
          registerResult.masterKeySalt,
          password
        );

        if (keyLoaded) {
          logger.debug('Encryption key loaded successfully after registration');
        }
      }

      this.sessionManager.setLoading(false);
      return registerResult;
    } catch (error) {
      logger.error('Registration failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Registration failed';
      this.sessionManager.setError(errorMessage);
      
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout(skipApiCall = false): Promise<void> {
    this.sessionManager.setLoading(true);
    this.sessionManager.setLoggingOut(true);

    try {
      // Call logout API if not skipped
      if (!skipApiCall) {
        await this.apiClient.logout();
      }

      // Clear auth state
      await this.resetAuthState();
      
      // Clear session
      this.sessionManager.clearSession();
      
      // Reset unlock attempts
      this.unlockAttempts = 0;
      
      logger.info('Logout completed successfully');
    } catch (error) {
      logger.error('Logout failed:', error);
      
      // Even if API fails, clear local state
      await this.resetAuthState();
      this.sessionManager.clearSession();
      
      const errorMessage = error instanceof Error ? error.message : 'Logout failed';
      this.sessionManager.setError(errorMessage);
    } finally {
      this.sessionManager.setLoggingOut(false);
    }
  }

  /**
   * Verify two-factor authentication
   */
  async verifyTwoFactor(userId: string, code: string): Promise<TwoFactorVerificationResult> {
    this.sessionManager.setLoading(true);
    this.sessionManager.setError(null);

    try {
      // Get stored credentials with password
      const credentials = await this.storage.getCredentials();
      if (!credentials) {
        throw new Error('No credentials found for 2FA verification');
      }

      const result = await this.apiClient.verifyTwoFactor(userId, code);

      if (!result.success) {
        throw new Error(result.message || '2FA verification failed');
      }

      // Finalize 2FA login
      await this.finalize2FALogin(result);

      return result;
    } catch (error) {
      logger.error('2FA verification failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : '2FA verification failed';
      this.sessionManager.setError(errorMessage);
      
      throw error;
    }
  }

  /**
   * Refresh authentication token
   */
  async refreshToken(refreshToken?: string): Promise<LoginResult> {
    try {
      const result = await this.apiClient.refreshToken(refreshToken);

      if (result.success && result.user) {
        // Check if master key is already loaded
        const hasE2E = this.cryptoManager.isInitialized();
        
        // Update session with refreshed data
        this.sessionManager.setAuthenticated(result.user, hasE2E);
        
        // Save credentials if we have encryption data
        if (result.encryptedMasterKey && result.masterKeySalt) {
          await this.saveAuthCredentials(result);
        }
      }

      return result;
    } catch (error) {
      logger.error('Token refresh failed:', error);
      throw error;
    }
  }

  /**
   * Complete login process
   */
  async completeLogin(loginData: LoginResult, password: string): Promise<boolean> {
    logger.debug('Completing login process...');

    try {
      // Check if we have encryption data
      if (!loginData.encryptedMasterKey || !loginData.masterKeySalt || !loginData.user?.id) {
        logger.error('Missing essential data for completing login');
        this.sessionManager.setError('Incomplete data received to finalize login');
        return false;
      }

      // Load master key
      logger.debug('Attempting to load master key...');
      const keyLoaded = await this.cryptoManager.loadUserMasterKey(
        loginData.encryptedMasterKey,
        loginData.masterKeySalt,
        password
      );

      if (!keyLoaded || !this.cryptoManager.isInitialized()) {
        logger.error('Failed to load master key during login completion');
        this.sessionManager.setError('Failed to load encryption key');
        await this.resetAuthState();
        return false;
      }

      logger.debug('Master key loaded successfully');

      // Update session state
      this.sessionManager.setAuthenticated(loginData.user, true);

      // Save credentials for offline access
      await this.saveAuthCredentials(loginData);

      // Save user settings
      await this.saveUserSettings(loginData.user);

      // Initialize storage with E2E
      if (this.onStorageInit) {
        try {
          await this.onStorageInit(this.cryptoManager, 'login');
          logger.info('Storage initialized with E2E after login');
        } catch (storageError) {
          logger.error('Failed to initialize storage after login:', storageError);
          // Don't fail login because of storage initialization
        }
      }

      return true;
    } catch (error) {
      logger.error('Error during login completion:', error);
      this.sessionManager.setError(error instanceof Error ? error.message : 'Failed to complete login');
      await this.resetAuthState();
      return false;
    }
  }

  /**
   * Finalize 2FA login
   */
  async finalize2FALogin(verificationData: TwoFactorVerificationResult): Promise<boolean> {
    logger.debug('Finalizing login after successful 2FA verification...');

    try {
      // Check if master key is loaded
      if (!this.cryptoManager.isInitialized()) {
        logger.error('Master key not loaded before finalizing 2FA login');
        this.sessionManager.setError('Encryption key state invalid after 2FA');
        await this.resetAuthState();
        return false;
      }

      if (!verificationData.user?.id || !verificationData.user?.username) {
        logger.error('Missing essential user data in 2FA finalization');
        this.sessionManager.setError('Incomplete user data received after 2FA');
        return false;
      }

      // Update session state
      this.sessionManager.setAuthenticated(verificationData.user, true);

      // Save user settings
      await this.saveUserSettings(verificationData.user);

      // Update stored credentials with full user profile
      const existingCreds = await this.storage.getCredentials();
      if (existingCreds) {
        await this.storage.saveCredentials({
          ...existingCreds,
          user_profile: verificationData.user
        });
      }

      // Initialize storage with E2E
      if (this.onStorageInit) {
        try {
          await this.onStorageInit(this.cryptoManager, 'login');
          logger.info('E2E storage initialized after 2FA login');
        } catch (storageError) {
          logger.error('Failed to initialize storage after 2FA login:', storageError);
          this.sessionManager.setError('Failed to initialize secure storage after 2FA');
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('Error during 2FA login finalization:', error);
      this.sessionManager.setError(error instanceof Error ? error.message : 'Failed to finalize 2FA login');
      await this.resetAuthState();
      return false;
    }
  }

  /**
   * Save authentication credentials
   */
  private async saveAuthCredentials(loginData: LoginResult): Promise<void> {
    if (!loginData.user || !loginData.encryptedMasterKey || !loginData.masterKeySalt) {
      return;
    }

    try {
      await this.storage.saveCredentials({
        id: 'currentUser',
        encrypted_master_key: loginData.encryptedMasterKey,
        master_key_salt: loginData.masterKeySalt,
        user_profile: loginData.user
      });
      logger.debug('Auth credentials saved');
    } catch (error) {
      logger.error('Failed to save auth credentials:', error);
      // Don't throw - this is non-critical
    }
  }

  /**
   * Save user settings
   */
  private async saveUserSettings(user: AuthUser): Promise<void> {
    if (!user?.id) return;

    try {
      await this.storage.saveUserSettings({
        id: user.id,
        is_2fa_enabled: user.is_2fa_enabled || false,
        preferred_language: user.preferred_language || 'en',
        preferred_date_format: user.preferred_date_format || 'yyyy-MM-dd'
      });
      logger.debug('User settings saved');

      // Update UI language if handler provided
      if (this.onLanguageChange && user.preferred_language) {
        this.onLanguageChange(user.preferred_language);
      }
    } catch (error) {
      logger.error('Failed to save user settings:', error);
      // Don't throw - this is non-critical
    }
  }

  /**
   * Reset authentication state
   */
  private async resetAuthState(): Promise<void> {
    try {
      // Clear master key
      this.cryptoManager.clearMasterKey();
      
      // Clear stored credentials
      await this.storage.clearCredentials();
      
      logger.debug('Auth state reset');
    } catch (error) {
      logger.error('Error resetting auth state:', error);
    }
  }

  /**
   * Try offline login with stored credentials
   */
  async tryOfflineLogin(password: string): Promise<boolean> {
    try {
      const credentials = await this.storage.getCredentials();
      
      if (!credentials) {
        logger.debug('No stored credentials for offline login');
        return false;
      }

      // Try to load master key with stored credentials
      const keyLoaded = await this.cryptoManager.loadUserMasterKey(
        credentials.encrypted_master_key,
        credentials.master_key_salt,
        password
      );

      if (!keyLoaded) {
        logger.error('Failed to load master key for offline login');
        return false;
      }

      // Update session
      this.sessionManager.setAuthenticated(credentials.user_profile, true);

      // Load user settings
      const settings = await this.storage.getUserSettings();
      if (settings && this.onLanguageChange && settings.preferred_language) {
        this.onLanguageChange(settings.preferred_language);
      }

      // Initialize storage with E2E
      if (this.onStorageInit) {
        await this.onStorageInit(this.cryptoManager, 'login');
      }

      logger.info('Offline login successful');
      return true;
    } catch (error) {
      logger.error('Offline login failed:', error);
      return false;
    }
  }

  /**
   * Check if offline login is available
   */
  async hasOfflineCredentials(): Promise<boolean> {
    try {
      const credentials = await this.storage.getCredentials();
      return !!credentials;
    } catch (error) {
      logger.error('Failed to check offline credentials:', error);
      return false;
    }
  }

  /**
   * Unlock E2E encryption with password
   * Used when user has active session but needs to unlock encryption after browser restart
   */
  async unlockE2E(password: string): Promise<UnlockE2EResult> {
    this.sessionManager.setLoading(true);
    this.sessionManager.setError(null);

    try {
      // Check if too many attempts
      if (this.unlockAttempts >= this.MAX_UNLOCK_ATTEMPTS) {
        logger.warn('Too many unlock attempts, forcing logout');
        await this.logout(true);
        return {
          success: false,
          message: 'Too many failed attempts. Please login again.'
        };
      }

      // Check if user is authenticated (has valid session)
      if (!this.sessionManager.isAuthenticated()) {
        return {
          success: false,
          message: 'No active session found'
        };
      }

      // Get stored credentials
      const credentials = await this.storage.getCredentials();
      if (!credentials) {
        logger.error('No stored credentials found for E2E unlock');
        return {
          success: false,
          message: 'No encryption data found'
        };
      }

      // Try to load master key with provided password
      logger.debug(`Attempting to unlock E2E for user: ${credentials.user_profile.username}`);
      const keyLoaded = await this.cryptoManager.loadUserMasterKey(
        credentials.encrypted_master_key,
        credentials.master_key_salt,
        password
      );

      if (!keyLoaded || !this.cryptoManager.isInitialized()) {
        logger.error('Failed to unlock E2E with provided password');
        
        // Increment failed attempts counter
        this.unlockAttempts++;
        const attemptsRemaining = this.MAX_UNLOCK_ATTEMPTS - this.unlockAttempts;
        
        return {
          success: false,
          username: credentials.user_profile.username,
          message: `Invalid password. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`,
          attemptsRemaining
        };
      }

      logger.debug('E2E unlocked successfully');

      // Reset unlock attempts on success
      this.unlockAttempts = 0;

      // Update session to reflect E2E is now available
      this.sessionManager.setSession({
        ...this.sessionManager.getCurrentSession(),
        hasE2E: true
      });

      // Initialize storage with E2E if callback provided
      if (this.onStorageInit) {
        try {
          await this.onStorageInit(this.cryptoManager, 'restore');
          logger.info('Storage re-initialized with E2E after unlock');
        } catch (storageError) {
          logger.error('Failed to re-initialize storage after E2E unlock:', storageError);
          // Don't fail the unlock because of storage initialization
        }
      }

      // Load user settings to apply preferences
      const settings = await this.storage.getUserSettings();
      if (settings && this.onLanguageChange && settings.preferred_language) {
        this.onLanguageChange(settings.preferred_language);
      }

      this.sessionManager.setLoading(false);
      return {
        success: true,
        username: credentials.user_profile.username
      };
    } catch (error) {
      logger.error('E2E unlock failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to unlock encryption';
      this.sessionManager.setError(errorMessage);
      
      return {
        success: false,
        message: errorMessage
      };
    } finally {
      this.sessionManager.setLoading(false);
    }
  }
}
