/**
 * App Lock's biometric prompt for this build: nothing on the web, the shared
 * raw Capacitor bridge in the native shell (`@reborn/platform/native`,
 * biometric-auth.ts - the same one re/notes uses; why a raw bridge and not the
 * plugin package: see that module's header and guideline 66). A compile-time
 * constant per build, so the web bundle drops the bridge.
 */

import {
	getCapacitorBiometryStatus,
	NO_BIOMETRY,
	promptCapacitorBiometric,
	type BiometricAuthResult,
	type BiometricPromptOptions,
	type BiometryStatus
} from '@reborn/platform/native';

export type {
	BiometricAuthResult,
	BiometricPromptOptions,
	BiometryKind,
	BiometryStatus
} from '@reborn/platform/native';

/** Whether biometry (or a device credential) is set up; "nothing" on the web. */
export async function getBiometryStatus(): Promise<BiometryStatus> {
	if (!__REBORN_NATIVE__) return NO_BIOMETRY;
	return getCapacitorBiometryStatus();
}

/**
 * Prompt for biometric (or, with `allowDeviceCredential`, device-credential)
 * authentication. `{ ok: false, code }` carries a `BiometryErrorType` string.
 * Never rejects.
 */
export async function promptBiometric(
	options: BiometricPromptOptions = {}
): Promise<BiometricAuthResult> {
	if (!__REBORN_NATIVE__) return { ok: false, code: 'biometryNotAvailable' };
	return promptCapacitorBiometric(options);
}
