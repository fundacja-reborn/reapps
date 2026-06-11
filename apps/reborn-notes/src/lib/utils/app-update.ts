/**
 * Native min-version update gate - pure decision logic (Faza 5, plan D5).
 *
 * Native shells can run one build for months (store-only updates - the OTA
 * paradox is a feature, see the capacitor plan), so the FIRST shipped build
 * must already know how to ask users to update. The server publishes
 * per-platform thresholds at GET /api/app-config; the shell compares its own
 * build number locally and renders:
 *   - required:    full-screen gate (build < min_build)
 *   - recommended: one-per-session toast (build < recommended_build)
 * Nothing is ever sent to the server (no version header - zero telemetry).
 *
 * Pure and platform-free so it unit-tests without Capacitor; the native-gated
 * runtime half lives in native-app-update.ts.
 */

export type NativePlatform = 'android' | 'ios';
export type UpdateSeverity = 'ok' | 'recommended' | 'required';

export interface NativeUpdateConfig {
  minBuild: number;
  recommendedBuild: number;
  storeUrl: string | null;
}

const positiveInt = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;

/**
 * Defensive parse of the /api/app-config response body for one platform.
 * Returns null when the shape is unusable - the caller fails open (an old
 * client must keep working against any future response shape).
 */
export function parseAppConfig(
  body: unknown,
  platform: NativePlatform
): NativeUpdateConfig | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as Record<string, unknown>).data;
  if (typeof data !== 'object' || data === null) return null;
  const native = (data as Record<string, unknown>).native;
  if (typeof native !== 'object' || native === null) return null;
  const entry = (native as Record<string, unknown>)[platform];
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  return {
    minBuild: positiveInt(record.min_build),
    recommendedBuild: positiveInt(record.recommended_build),
    storeUrl:
      typeof record.store_url === 'string' && record.store_url.length > 0
        ? record.store_url
        : null
  };
}

/**
 * `required` wins over `recommended`; an unknown current build (0/NaN - e.g.
 * an emulator artifact without a numeric build) always passes - the gate must
 * never lock someone out on bad input.
 */
export function evaluateUpdateSeverity(
  currentBuild: number,
  config: NativeUpdateConfig
): UpdateSeverity {
  if (!Number.isInteger(currentBuild) || currentBuild <= 0) return 'ok';
  if (config.minBuild > 0 && currentBuild < config.minBuild) return 'required';
  if (config.recommendedBuild > 0 && currentBuild < config.recommendedBuild) {
    return 'recommended';
  }
  return 'ok';
}

/**
 * Store listing fallback when the server does not provide one. Android's URL
 * derives from the package id; iOS needs the numeric App Store id, which only
 * exists post-publication - served via NATIVE_STORE_URL_IOS then.
 */
export function defaultStoreUrl(platform: NativePlatform, appId: string): string | null {
  if (platform === 'android' && appId) {
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`;
  }
  return null;
}
