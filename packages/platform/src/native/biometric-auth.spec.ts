/**
 * Locks the raw-bridge biometric facade to the plugin's contract.
 *
 * `biometric-auth.ts` deliberately avoids importing the plugin's JS module at
 * runtime (its lazy platform factory is the iOS cold-start wedge pattern - see
 * the module header) and duplicates the `BiometryType` enum as literals. This
 * spec imports the package HERE (test-only, node context) and asserts the
 * literals match, so a plugin upgrade that renumbers the enum fails loudly
 * instead of labelling Face ID as a fingerprint on the lock screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = {
  checkBiometry: vi.fn(),
  internalAuthenticate: vi.fn()
};

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => native
}));

const { BiometryType } = await import('@aparajita/capacitor-biometric-auth');
const {
  BIOMETRY_TYPE,
  NO_BIOMETRY,
  getCapacitorBiometryStatus,
  promptCapacitorBiometric,
  toBiometryKind
} = await import('./biometric-auth');

beforeEach(() => {
  native.checkBiometry.mockReset();
  native.internalAuthenticate.mockReset();
});

describe('BIOMETRY_TYPE', () => {
  it('matches the plugin enum', () => {
    expect(BIOMETRY_TYPE).toEqual({
      none: BiometryType.none,
      touchId: BiometryType.touchId,
      faceId: BiometryType.faceId,
      fingerprint: BiometryType.fingerprintAuthentication,
      face: BiometryType.faceAuthentication,
      iris: BiometryType.irisAuthentication
    });
  });

  it('maps every plugin type to a label, unknown ones to none', () => {
    expect(toBiometryKind(BiometryType.faceId)).toBe('faceId');
    expect(toBiometryKind(BiometryType.fingerprintAuthentication)).toBe('fingerprint');
    expect(toBiometryKind(99)).toBe('none');
  });
});

describe('getCapacitorBiometryStatus', () => {
  it('normalizes the plugin result', async () => {
    native.checkBiometry.mockResolvedValue({
      isAvailable: true,
      strongBiometryIsAvailable: true,
      biometryType: BiometryType.faceId,
      biometryTypes: [BiometryType.faceId],
      deviceIsSecure: true,
      reason: '',
      code: ''
    });
    await expect(getCapacitorBiometryStatus()).resolves.toEqual({
      isAvailable: true,
      deviceIsSecure: true,
      kind: 'faceId'
    });
  });

  it('reads a plugin error as nothing available', async () => {
    native.checkBiometry.mockRejectedValue(new Error('not implemented'));
    await expect(getCapacitorBiometryStatus()).resolves.toEqual(NO_BIOMETRY);
  });
});

describe('promptCapacitorBiometric', () => {
  it('resolves ok and passes the options through', async () => {
    native.internalAuthenticate.mockResolvedValue(undefined);
    await expect(promptCapacitorBiometric({ reason: 'Unlock' })).resolves.toEqual({ ok: true });
    expect(native.internalAuthenticate).toHaveBeenCalledWith({ reason: 'Unlock' });
  });

  it('turns a rejection into its BiometryErrorType code, never rejects', async () => {
    native.internalAuthenticate.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'userCancel' })
    );
    await expect(promptCapacitorBiometric()).resolves.toEqual({ ok: false, code: 'userCancel' });
    native.internalAuthenticate.mockRejectedValue('weird');
    await expect(promptCapacitorBiometric()).resolves.toEqual({
      ok: false,
      code: 'authenticationFailed'
    });
  });
});
