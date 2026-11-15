import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `authStore.unlockWithPassword` - the flow behind the `/auth/unlock` screen.
 *
 * Two rules matter for data safety and are pinned here:
 *  - wrong passwords never sign the user out (logout wipes local data,
 *    unsynced edits included); they only add to a retry delay
 *  - a locally stored key wrap that no longer opens (password changed on
 *    another device) is refreshed from the server before the attempt counts
 *    as a failure
 */

const crypto = vi.hoisted(() => ({
  loadUserMasterKey: vi.fn<(wrap: string, salt: string, password: string) => Promise<boolean>>(),
  getAccountUnlockRetryDelayMs: vi.fn(() => 0),
  recordAccountUnlockFailure: vi.fn(() => 0),
  isInitialized: vi.fn(() => false),
  clearMasterKey: vi.fn(),
  clearWebLock: vi.fn(),
  setAppLockEnabled: vi.fn(),
  subscribeToKeyEvents: vi.fn()
}));
const refreshAccountWrap = vi.hoisted(() => vi.fn());

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/paths', () => ({ base: '' }));
vi.mock('@reborn/crypto', () => ({ cryptoManager: crypto }));
vi.mock('$lib/utils/api-base', () => ({ API_BASE: '/api' }));
vi.mock('$lib/utils/native-auth-storage', () => ({ clearNativeRefreshToken: vi.fn() }));
vi.mock('$lib/utils/native-session', () => ({ clearNativeSessionId: vi.fn() }));
vi.mock('$lib/stores/start-place', () => ({ forgetRememberedPlace: vi.fn() }));
vi.mock('$lib/stores/sync-status.store', () => ({
  sessionExpired: { set: vi.fn() },
  localOnly: { set: vi.fn() }
}));
vi.mock('$lib/services/notes-auth.service', () => ({ refreshAccountWrap }));
vi.mock('$lib/services/device-info.service', () => ({
  sendEncryptedDeviceInfo: vi.fn(async () => undefined)
}));

const CREDENTIALS_KEY = 'reborn_auth_credentials';

function stubBrowser(online: boolean) {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key)
  });
  vi.stubGlobal('navigator', { onLine: online });
  store.set(
    CREDENTIALS_KEY,
    JSON.stringify({
      id: 'u1',
      encrypted_master_key: 'wrap-old',
      master_key_salt: 'salt-old',
      user_profile: { username: 'ada' }
    })
  );
  return store;
}

async function loadStore() {
  vi.resetModules();
  const { authStore } = await import('./auth.store');
  return authStore;
}

describe('authStore.unlockWithPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crypto.getAccountUnlockRetryDelayMs.mockReturnValue(0);
    crypto.recordAccountUnlockFailure.mockReturnValue(0);
  });

  it('unlocks with the right password without touching the network', async () => {
    stubBrowser(true);
    crypto.loadUserMasterKey.mockResolvedValue(true);
    const authStore = await loadStore();

    expect(await authStore.unlockWithPassword('pw')).toEqual({ kind: 'ok' });
    expect(crypto.loadUserMasterKey).toHaveBeenCalledWith('wrap-old', 'salt-old', 'pw');
    expect(refreshAccountWrap).not.toHaveBeenCalled();
    expect(crypto.recordAccountUnlockFailure).not.toHaveBeenCalled();
  });

  it('refuses an attempt while a retry delay is running', async () => {
    stubBrowser(true);
    crypto.getAccountUnlockRetryDelayMs.mockReturnValue(7_000);
    const authStore = await loadStore();

    expect(await authStore.unlockWithPassword('pw')).toEqual({
      kind: 'throttled',
      retryAfterMs: 7_000
    });
    expect(crypto.loadUserMasterKey).not.toHaveBeenCalled();
  });

  it('counts a wrong password offline and says the server could not be asked', async () => {
    stubBrowser(false);
    crypto.loadUserMasterKey.mockResolvedValue(false);
    crypto.recordAccountUnlockFailure.mockReturnValue(10_000);
    const authStore = await loadStore();

    expect(await authStore.unlockWithPassword('nope')).toEqual({
      kind: 'invalid_password',
      retryAfterMs: 10_000,
      offline: true
    });
    expect(refreshAccountWrap).not.toHaveBeenCalled();
    expect(crypto.recordAccountUnlockFailure).toHaveBeenCalledTimes(1);
  });

  it('counts a wrong password the server also rejects', async () => {
    stubBrowser(true);
    crypto.loadUserMasterKey.mockResolvedValue(false);
    refreshAccountWrap.mockResolvedValue({ kind: 'invalid_password' });
    const authStore = await loadStore();

    expect(await authStore.unlockWithPassword('nope')).toEqual({
      kind: 'invalid_password',
      retryAfterMs: 0,
      offline: false
    });
    expect(crypto.recordAccountUnlockFailure).toHaveBeenCalledTimes(1);
  });

  it('recovers from a stale wrap: password changed on another device', async () => {
    const store = stubBrowser(true);
    // The old wrap does not open with the new password; the refreshed one does.
    crypto.loadUserMasterKey.mockImplementation(async (wrap) => wrap === 'wrap-new');
    refreshAccountWrap.mockImplementation(async () => {
      const creds = JSON.parse(store.get(CREDENTIALS_KEY) as string);
      store.set(
        CREDENTIALS_KEY,
        JSON.stringify({ ...creds, encrypted_master_key: 'wrap-new', master_key_salt: 'salt-new' })
      );
      return { kind: 'refreshed' };
    });
    const authStore = await loadStore();

    expect(await authStore.unlockWithPassword('new-pw')).toEqual({ kind: 'ok' });
    expect(refreshAccountWrap).toHaveBeenCalledWith('new-pw');
    expect(crypto.loadUserMasterKey).toHaveBeenLastCalledWith('wrap-new', 'salt-new', 'new-pw');
    expect(crypto.recordAccountUnlockFailure).not.toHaveBeenCalled();
  });

  it('reports the server sign-in lockout without adding a local failure', async () => {
    stubBrowser(true);
    crypto.loadUserMasterKey.mockResolvedValue(false);
    refreshAccountWrap.mockResolvedValue({ kind: 'locked', retryAfter: 900 });
    const authStore = await loadStore();

    expect(await authStore.unlockWithPassword('nope')).toEqual({
      kind: 'server_locked',
      retryAfter: 900
    });
    expect(crypto.recordAccountUnlockFailure).not.toHaveBeenCalled();
  });

  it('treats an unreachable server like being offline', async () => {
    stubBrowser(true);
    crypto.loadUserMasterKey.mockResolvedValue(false);
    refreshAccountWrap.mockResolvedValue({ kind: 'error' });
    const authStore = await loadStore();

    expect(await authStore.unlockWithPassword('nope')).toMatchObject({
      kind: 'invalid_password',
      offline: true
    });
  });

  it('never signs the user out, however many wrong passwords are typed', async () => {
    const store = stubBrowser(false);
    crypto.loadUserMasterKey.mockResolvedValue(false);
    const authStore = await loadStore();

    for (let i = 0; i < 12; i++) await authStore.unlockWithPassword('nope');

    expect(store.get(CREDENTIALS_KEY)).toBeDefined();
    expect(crypto.clearMasterKey).not.toHaveBeenCalled();
    expect(crypto.recordAccountUnlockFailure).toHaveBeenCalledTimes(12);
  });
});
