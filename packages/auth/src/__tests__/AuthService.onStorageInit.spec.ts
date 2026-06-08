import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../services/AuthService';
import { SessionManager } from '../services/SessionManager';
import type { IAuthStorage, IAuthApiClient } from '../services/AuthService';
import type { CryptoManager } from '@reborn/crypto';
import type { LoginResult, AuthCredentials } from '../types';

/**
 * Regression tests for BUG-1: `onStorageInit` callback must receive a `context`
 * argument so consumers can distinguish user-switch (login) from same-user key
 * restore. Clearing IndexedDB on 'restore' causes offline data loss.
 */

const VALID_USER = {
  id: 'user-1',
  username: 'alice',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

function makeCryptoManager(initialized = true): CryptoManager {
  return {
    loadUserMasterKey: vi.fn().mockResolvedValue(true),
    isInitialized: vi.fn().mockReturnValue(initialized),
    clearMasterKey: vi.fn()
  } as unknown as CryptoManager;
}

function makeStorage(existingCreds?: AuthCredentials): IAuthStorage {
  let creds: AuthCredentials | null = existingCreds ?? null;
  return {
    getCredentials: vi.fn(async () => creds),
    saveCredentials: vi.fn(async (c: AuthCredentials) => {
      creds = c;
    }),
    clearCredentials: vi.fn(async () => {
      creds = null;
    }),
    getUserSettings: vi.fn(async () => null),
    saveUserSettings: vi.fn(async () => {/* no-op */})
  };
}

function makeApiClient(loginResult: LoginResult): IAuthApiClient {
  return {
    login: vi.fn().mockResolvedValue(loginResult),
    register: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    verifyTwoFactor: vi.fn(),
    refreshToken: vi.fn()
  } as unknown as IAuthApiClient;
}

describe('AuthService onStorageInit context', () => {
  let onStorageInit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onStorageInit = vi.fn().mockResolvedValue(undefined);
  });

  it('passes context="login" on completeLogin (user-switch path)', async () => {
    const loginResult: LoginResult = {
      success: true,
      user: VALID_USER,
      encryptedMasterKey: 'enc',
      masterKeySalt: 'salt'
    };
    const service = new AuthService(
      makeCryptoManager(),
      new SessionManager(),
      makeStorage(),
      makeApiClient(loginResult),
      onStorageInit
    );

    await service.login('alice', 'password');

    expect(onStorageInit).toHaveBeenCalledTimes(1);
    expect(onStorageInit).toHaveBeenCalledWith(expect.anything(), 'login');
  });

  it('passes context="login" on tryOfflineLogin', async () => {
    const credentials: AuthCredentials = {
      id: 'currentUser',
      encrypted_master_key: 'enc',
      master_key_salt: 'salt',
      user_profile: VALID_USER
    };
    const service = new AuthService(
      makeCryptoManager(),
      new SessionManager(),
      makeStorage(credentials),
      makeApiClient({ success: true }),
      onStorageInit
    );

    const ok = await service.tryOfflineLogin('password');

    expect(ok).toBe(true);
    expect(onStorageInit).toHaveBeenCalledWith(expect.anything(), 'login');
  });

  it('passes context="restore" on unlockE2E (same user, preserve local data)', async () => {
    const credentials: AuthCredentials = {
      id: 'currentUser',
      encrypted_master_key: 'enc',
      master_key_salt: 'salt',
      user_profile: VALID_USER
    };
    const sessionManager = new SessionManager();
    // Simulate an existing session (required for unlockE2E)
    sessionManager.setAuthenticated(VALID_USER, false);

    const service = new AuthService(
      makeCryptoManager(),
      sessionManager,
      makeStorage(credentials),
      makeApiClient({ success: true }),
      onStorageInit
    );

    const result = await service.unlockE2E('password');

    expect(result.success).toBe(true);
    expect(onStorageInit).toHaveBeenCalledWith(expect.anything(), 'restore');
  });

  it('does NOT call onStorageInit with a missing context argument', async () => {
    // Regression guard — earlier implementation called onStorageInit(cryptoManager)
    // without a context, which made consumers default to clearing IndexedDB.
    const loginResult: LoginResult = {
      success: true,
      user: VALID_USER,
      encryptedMasterKey: 'enc',
      masterKeySalt: 'salt'
    };
    const service = new AuthService(
      makeCryptoManager(),
      new SessionManager(),
      makeStorage(),
      makeApiClient(loginResult),
      onStorageInit
    );

    await service.login('alice', 'password');

    const call = onStorageInit.mock.calls[0];
    expect(call.length).toBeGreaterThanOrEqual(2);
    expect(['login', 'restore']).toContain(call[1]);
  });
});
