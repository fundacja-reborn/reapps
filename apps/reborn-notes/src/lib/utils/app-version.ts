/**
 * Pure parse of the live backend version from the /api/app-config response body
 * (Settings "About" version display, guideline 38 "Wersje w aplikacji
 * natywnej"). Deliberately free of SvelteKit/Capacitor imports so it unit-tests
 * without the app environment - the native-gated runtime half (App.getInfo plus
 * the fetch) lives in native-version-info.ts, mirroring the app-update.ts /
 * native-app-update.ts split.
 *
 * Returns null for any unusable shape: an old client must keep rendering its own
 * version even if a future server changes the response.
 */
export function parseBackendVersion(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as Record<string, unknown>).data;
  if (typeof data !== 'object' || data === null) return null;
  const version = (data as Record<string, unknown>).version;
  return typeof version === 'string' && version.length > 0 ? version : null;
}
