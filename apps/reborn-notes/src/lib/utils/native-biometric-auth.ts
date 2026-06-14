/**
 * Raw-bridge access to the native biometric-auth plugin
 * (`@aparajita/capacitor-biometric-auth`), used by the App Lock feature.
 *
 * Talks DIRECTLY to the natively-registered plugin via Capacitor's
 * `registerPlugin('BiometricAuthNative')` proxy, exactly like
 * `native-secure-storage.ts`. The package's own entry point is deliberately
 * NOT imported: it builds its proxy with a lazy platform factory
 * (`registerPlugin('BiometricAuthNative', { ios: async () => import('./native.js'), ... })`),
 * i.e. a nested dynamic import resolved on first call. That is the exact
 * boot-storm wedge pattern that hung iOS cold start twice in Faza 4 (see
 * native-secure-storage.ts header + guideline 61 "boot-time wedge"). The App
 * Lock screen shows at cold start, so its first biometric call is close to that
 * window - the raw proxy (synchronous `registerPlugin`, no factory, no nested
 * import) keeps it off the wedge path entirely.
 *
 * `@capacitor/core` is imported STATICALLY (same reason as
 * native-secure-storage.ts): on native it is already in the boot bundle, and on
 * web `registerPlugin` is only referenced inside the compile-time-false
 * `__REBORN_NATIVE__` branch, so the whole module - plugin included - is
 * tree-shaken from the web bundle.
 *
 * The native method surface is `checkBiometry` + `internalAuthenticate` (the
 * `internal*` name is the plugin's native method; the package's public
 * `authenticate()` just re-wraps its rejection as a typed `BiometryError`,
 * which we replicate here by reading the `.code` string off the rejection).
 */

import { registerPlugin } from '@capacitor/core';

/**
 * Biometry type, mirroring the plugin's `BiometryType` enum (duplicated as
 * literals so the wedging package module stays unimported). Locked by
 * `native-biometric-auth.spec.ts` against the package.
 */
const BIOMETRY_TYPE = {
  none: 0,
  touchId: 1,
  faceId: 2,
  fingerprint: 3,
  face: 4,
  iris: 5
} as const;

/** A stable, platform-neutral biometry label the UI maps to an i18n string. */
export type BiometryKind = 'faceId' | 'touchId' | 'fingerprint' | 'face' | 'iris' | 'none';

/** Result of a biometric prompt attempt. `code` is a `BiometryErrorType` string. */
export type BiometricAuthResult = { ok: true } | { ok: false; code: string };

/** Subset of the plugin's `CheckBiometryResult` we consume. */
interface RawCheckBiometryResult {
  isAvailable: boolean;
  strongBiometryIsAvailable: boolean;
  biometryType: number;
  biometryTypes: number[];
  deviceIsSecure: boolean;
  reason: string;
  code: string;
}

/** Subset of the plugin's `AuthenticateOptions` we pass through. */
export interface BiometricPromptOptions {
  reason?: string;
  cancelTitle?: string;
  allowDeviceCredential?: boolean;
  iosFallbackTitle?: string;
  androidTitle?: string;
  androidSubtitle?: string;
  androidConfirmationRequired?: boolean;
}

/** The plugin's native method surface (see its ios/android sources). */
interface RawBiometricPlugin {
  checkBiometry(): Promise<RawCheckBiometryResult>;
  internalAuthenticate(options: BiometricPromptOptions): Promise<void>;
}

/** Device biometry status, normalized for the App Lock UI. */
export interface BiometryStatus {
  /** Weak-or-better biometry is available AND enrolled. */
  isAvailable: boolean;
  /** Device has a PIN/pattern/passcode (iOS: passcode set). */
  deviceIsSecure: boolean;
  /** Primary biometry kind, for labelling ("Face ID", "Fingerprint", …). */
  kind: BiometryKind;
}

let rawPlugin: RawBiometricPlugin | null = null;

/** Lazily build the raw plugin proxy. Native-only. */
function getPlugin(): RawBiometricPlugin {
  // registerPlugin is synchronous (a proxy over the already-injected native
  // bridge) - no async init step a boot race could wedge.
  rawPlugin ??= registerPlugin<RawBiometricPlugin>('BiometricAuthNative');
  return rawPlugin;
}

function toKind(type: number): BiometryKind {
  switch (type) {
    case BIOMETRY_TYPE.touchId:
      return 'touchId';
    case BIOMETRY_TYPE.faceId:
      return 'faceId';
    case BIOMETRY_TYPE.fingerprint:
      return 'fingerprint';
    case BIOMETRY_TYPE.face:
      return 'face';
    case BIOMETRY_TYPE.iris:
      return 'iris';
    default:
      return 'none';
  }
}

/**
 * Query whether biometry is available and enrolled on this device. Returns a
 * "nothing available" status on web or any plugin error, so callers can treat
 * the absence of biometry uniformly.
 */
export async function getBiometryStatus(): Promise<BiometryStatus> {
  if (!__REBORN_NATIVE__) {
    return { isAvailable: false, deviceIsSecure: false, kind: 'none' };
  }
  try {
    const result = await getPlugin().checkBiometry();
    return {
      isAvailable: result.isAvailable,
      deviceIsSecure: result.deviceIsSecure,
      kind: toKind(result.biometryType)
    };
  } catch {
    return { isAvailable: false, deviceIsSecure: false, kind: 'none' };
  }
}

/**
 * Prompt the user for biometric (or, when `allowDeviceCredential` is set,
 * device-credential) authentication. Resolves `{ ok: true }` on success or
 * `{ ok: false, code }` on any failure/cancel, where `code` is one of the
 * plugin's `BiometryErrorType` strings (e.g. `userCancel`, `biometryLockout`,
 * `biometryNotEnrolled`). Never rejects.
 */
export async function promptBiometric(
  options: BiometricPromptOptions = {}
): Promise<BiometricAuthResult> {
  if (!__REBORN_NATIVE__) {
    return { ok: false, code: 'biometryNotAvailable' };
  }
  try {
    await getPlugin().internalAuthenticate(options);
    return { ok: true };
  } catch (error: unknown) {
    // Capacitor surfaces `call.reject(message, code)` as an error carrying a
    // `.code` string (the BiometryErrorType). Fall back to a generic code when
    // the shape is unexpected.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'authenticationFailed';
    return { ok: false, code: code || 'authenticationFailed' };
  }
}
