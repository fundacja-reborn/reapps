import type { IAuthStorage } from '../services/AuthService';
import type { AuthCredentials, UserSettings } from '../types';

/**
 * Storage interface that auth storage implementations should follow
 */
export interface IGenericStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Create auth storage using a generic storage backend
 */
export function createAuthStorage(storage: IGenericStorage): IAuthStorage {
  const CREDENTIALS_KEY = 'auth_credentials';
  const SETTINGS_KEY = 'user_settings';

  return {
    async getCredentials(): Promise<AuthCredentials | null> {
      return storage.get<AuthCredentials>(CREDENTIALS_KEY);
    },

    async saveCredentials(credentials: AuthCredentials): Promise<void> {
      await storage.set(CREDENTIALS_KEY, credentials);
    },

    async clearCredentials(): Promise<void> {
      await storage.delete(CREDENTIALS_KEY);
    },

    async getUserSettings(): Promise<UserSettings | null> {
      return storage.get<UserSettings>(SETTINGS_KEY);
    },

    async saveUserSettings(settings: UserSettings): Promise<void> {
      await storage.set(SETTINGS_KEY, settings);
    }
  };
}

/**
 * Create a simple in-memory storage for testing
 */
export function createInMemoryAuthStorage(): IAuthStorage {
  const storage = new Map<string, any>();

  const genericStorage: IGenericStorage = {
    async get<T>(key: string): Promise<T | null> {
      return storage.get(key) || null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      storage.set(key, value);
    },
    async delete(key: string): Promise<void> {
      storage.delete(key);
    }
  };

  return createAuthStorage(genericStorage);
}
