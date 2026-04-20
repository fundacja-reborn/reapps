import type { IAuthStorage } from '@reborn/auth';
import type { AuthCredentials, UserSettings } from '@reborn/auth';
import { createLogger } from '@reborn/utils';

const logger = createLogger('AuthStorageAdapter');

/**
 * LocalStorage-based auth storage adapter
 */
export class AuthStorageAdapter implements IAuthStorage {
  private readonly CREDENTIALS_KEY = 'reborn_auth_credentials';
  private readonly SETTINGS_KEY = 'reborn_user_settings';
  
  async getCredentials(): Promise<AuthCredentials | null> {
    try {
      const stored = localStorage.getItem(this.CREDENTIALS_KEY);
      if (!stored) return null;
      
      return JSON.parse(stored);
    } catch (error: unknown) {
      logger.error('Failed to get credentials:', error);
      return null;
    }
  }
  
  async saveCredentials(credentials: AuthCredentials): Promise<void> {
    try {
      localStorage.setItem(this.CREDENTIALS_KEY, JSON.stringify(credentials));
    } catch (error: unknown) {
      logger.error('Failed to save credentials:', error);
      throw error;
    }
  }
  
  async clearCredentials(): Promise<void> {
    try {
      localStorage.removeItem(this.CREDENTIALS_KEY);
    } catch (error: unknown) {
      logger.error('Failed to clear credentials:', error);
    }
  }
  
  async getUserSettings(): Promise<UserSettings | null> {
    try {
      const stored = localStorage.getItem(this.SETTINGS_KEY);
      if (!stored) return null;
      
      return JSON.parse(stored);
    } catch (error: unknown) {
      logger.error('Failed to get user settings:', error);
      return null;
    }
  }
  
  async saveUserSettings(settings: UserSettings): Promise<void> {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
    } catch (error: unknown) {
      logger.error('Failed to save user settings:', error);
      throw error;
    }
  }
}
