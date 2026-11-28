/**
 * Raw-bridge access to the native biometric-auth plugin
 * (`@aparajita/capacitor-biometric-auth`), used by App Lock in both apps
 * (guideline 66). Moved here from re/notes when re/task gained App Lock
 * (2026-11-28), so the security bridge exists once.
 *
 * Talks DIRECTLY to the natively-registered plugin via Capacitor's
 * `registerPlugin('BiometricAuthNative')` proxy, exactly like
 * `secure-storage.ts`. The package's own entry point is deliberately NOT
 * imported: it builds its proxy with a lazy platform factory
 * (`registerPlugin('BiometricAuthNative', { ios: async () => import('./native.js'), ... })`),
 * i.e. a nested dynamic import resolved on first call. That is the exact
 * boot-storm wedge pattern that hung iOS cold start twice in Faza 4 (see the
 * `secure-storage.ts` header + guideline 61 "boot-time wedge"). The App Lock
 * screen shows at cold start, so its first biometric call is close to that
 * window - the raw proxy (synchronous `registerPlugin`, no factory, no nested
 * import) keeps it off the wedge path entirely.
 *
 * `@capacitor/core` is imported STATICALLY (same reason as `secure-storage.ts`):
 * on native it is already in the boot bundle, and the apps reach these
 * functions only behind the compile-time-false `__REBORN_NATIVE__` guard on the
 * web, so the module - plugin included - is tree-shaken from the web bundle.
 *
 * Flag-free like the rest of `@reborn/platform/native`: the apps' `$lib`
 * wrappers decide web / Capacitor / desktop (re/notes routes desktop builds to
 * its Tauri shell, which answers with the same status shape and error codes).
 *
 * The native method surface is `checkBiometry` + `internalAuthenticate` (the
 * `internal*` name is the plugin's native method; the package's public
 * `authenticate()` just re-wraps its rejection as a typed `BiometryError`,
 * which we replicate here by reading the `.code` string off the rejection).
 *
 * The proxy never leaves this module and is never awaited: a Capacitor plugin
 * answers every property with a native method wrapper, `then` included, so a
 * promise resolved with it would hang forever.
 */

import { registerPlugin } from '@capacitor/core';

/**
 * Biometry type, mirroring the plugin's `BiometryType` enum (duplicated as
 * literals so the wedging package module stays unimported). Locked by
 * `biometric-auth.spec.ts` against the package.
 */
export const BIOMETRY_TYPE = {
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

/** Subset of the plugin's `AuthenticateOptions` the apps pass through. */
export interface BiometricPromptOptions {
  reason?: string;
  cancelTitle?: string;
  allowDeviceCredential?: boolean;
  iosFallbackTitle?: string;
  androidTitle?: string;
  androidSubtitle?: string;
  androidConfirmationRequired?: boolean;
  /**
   * re/notes desktop shell on macOS only (not a plugin option, ignored by the
   * phones): the system prints the reason inside its own sentence, "<app> is
   * trying to <reason>.", so it needs a lower-case verb phrase instead of the
   * stand-alone `reason`.
   */
  macosReason?: string;
}

/** Device biometry status, normalized for the App Lock UI. */
export interface BiometryStatus {
  /** Weak-or-better biometry is available AND enrolled. */
  isAvailable: boolean;
  /** Device has a PIN/pattern/passcode (iOS: passcode set). */
  deviceIsSecure: boolean;
  /** Primary biometry kind, for labelling ("Face ID", "Fingerprint", ...). */
  kind: BiometryKind;
}

/** The "nothing available" status: web, a failed check, an unknown device. */
export const NO_BIOMETRY: BiometryStatus = {
  isAvailable: false,
  deviceIsSecure: false,
  kind: 'none'
};

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

/** The plugin's native method surface (see its ios/android sources). */
interface RawBiometricPlugin {
  checkBiometry(): Promise<RawCheckBiometryResult>;
  internalAuthenticate(options: BiometricPromptOptions): Promise<void>;
}

let rawPlugin: RawBiometricPlugin | null = null;

/** Lazily build the raw plugin proxy (synchronous - no async init a boot race could wedge). */
function getPlugin(): RawBiometricPlugin {
  rawPlugin ??= registerPlugin<RawBiometricPlugin>('BiometricAuthNative');
  return rawPlugin;
}

/** Map the plugin's numeric `BiometryType` to a UI label key. */
export function toBiometryKind(type: number): BiometryKind {
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
 * Whether biometry is available and enrolled on this device. Any plugin error
 * reads as "nothing available", so callers treat the absence uniformly.
 */
export async function getCapacitorBiometryStatus(): Promise<BiometryStatus> {
  try {
    const result = await getPlugin().checkBiometry();
    return {
      isAvailable: result.isAvailable,
      deviceIsSecure: result.deviceIsSecure,
      kind: toBiometryKind(result.biometryType)
    };
  } catch {
    return NO_BIOMETRY;
  }
}

/**
 * Prompt for biometric (or, with `allowDeviceCredential`, device-credential)
 * authentication. Resolves `{ ok: true }` on success or `{ ok: false, code }`
 * on any failure / cancel, where `code` is one of the plugin's
 * `BiometryErrorType` strings (e.g. `userCancel`, `biometryLockout`,
 * `biometryNotEnrolled`). Never rejects.
 */
export async function promptCapacitorBiometric(
  options: BiometricPromptOptions = {}
): Promise<BiometricAuthResult> {
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
