import { get } from 'svelte/store';
import { API_BASE } from '$lib/utils/api-base';
import { authFetch } from '$lib/utils/auth-fetch';
import { createSyncedSettingsService } from '@reborn/storage';
import { localOnly } from '$lib/stores/sync-status.store';

/**
 * App-level singleton of the E2E synced settings service. Wires the shared
 * implementation to this app's `authFetch` (single-flight 401 refresh) and
 * `base` path.
 *
 * `isSyncEnabled` gates every server round-trip off in local-only mode: there
 * is no account session there, so a settings PUT/GET would 401, trigger a
 * refresh that also 401s, and trip the session-expired banner. IndexedDB stays
 * the source of truth; sync resumes automatically after an account upgrade
 * (localOnly flips back to false). Mirrors the isAuthenticated gate in
 * notes-sync.service. See planning/local-only-no-account-plan.md.
 */
export const syncedSettings = createSyncedSettingsService({
  authFetch,
  basePath: API_BASE.replace(/\/api$/, ''),
  appName: 'reborn-notes',
  isSyncEnabled: () => !get(localOnly)
});
