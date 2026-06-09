import { API_BASE } from '$lib/utils/api-base';
import { authFetch } from '$lib/utils/auth-fetch';
import { createSyncedSettingsService } from '@reborn/storage';

/**
 * App-level singleton of the E2E synced settings service. Wires the shared
 * implementation to this app's `authFetch` (single-flight 401 refresh) and
 * `base` path.
 */
export const syncedSettings = createSyncedSettingsService({
  authFetch,
  basePath: API_BASE.replace(/\/api$/, ''),
  appName: 'reborn-notes'
});
