import { describe, expect, it } from 'vitest';
import type { NativeSecureStorage } from '../types';
import {
  clearRefreshToken,
  createSecureStorageMasterKeyVault,
  persistRefreshToken,
  readRefreshToken
} from './secure-items';

function memoryStorage(): NativeSecureStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async setItem(key, value) {
      data.set(key, value);
    },
    async getItem(key) {
      return data.get(key) ?? null;
    },
    async removeItem(key) {
      data.delete(key);
    }
  };
}

const failing = async (): Promise<NativeSecureStorage> => {
  throw new Error('bridge timed out');
};

describe('refresh token in secure storage', () => {
  it('round-trips under its own key', async () => {
    const storage = memoryStorage();
    const get = async () => storage;
    await persistRefreshToken(get, 'tok-1');
    expect(storage.data.get('refresh_token')).toBe('tok-1');
    await expect(readRefreshToken(get)).resolves.toBe('tok-1');
    await clearRefreshToken(get);
    await expect(readRefreshToken(get)).resolves.toBeNull();
  });

  it('ignores an empty token instead of overwriting the stored one', async () => {
    const storage = memoryStorage();
    storage.data.set('refresh_token', 'kept');
    await persistRefreshToken(async () => storage, undefined);
    await persistRefreshToken(async () => storage, '');
    expect(storage.data.get('refresh_token')).toBe('kept');
  });

  it('degrades to "no token" when the store is unreachable', async () => {
    await expect(persistRefreshToken(failing, 'tok')).resolves.toBeUndefined();
    await expect(readRefreshToken(failing)).resolves.toBeNull();
    await expect(clearRefreshToken(failing)).resolves.toBeUndefined();
  });
});

describe('master-key vault in secure storage', () => {
  it('keeps the key apart from the refresh token', async () => {
    const storage = memoryStorage();
    const vault = createSecureStorageMasterKeyVault(async () => storage);
    await persistRefreshToken(async () => storage, 'tok');
    await vault.save('a2V5');
    expect(storage.data.get('master_key')).toBe('a2V5');
    await expect(vault.load()).resolves.toBe('a2V5');
    await vault.clear();
    await expect(vault.load()).resolves.toBeNull();
    expect(storage.data.get('refresh_token')).toBe('tok');
  });

  it('degrades to "no key" when the store is unreachable', async () => {
    const vault = createSecureStorageMasterKeyVault(failing);
    await expect(vault.save('a2V5')).resolves.toBeUndefined();
    await expect(vault.load()).resolves.toBeNull();
    await expect(vault.clear()).resolves.toBeUndefined();
  });
});
