import { get } from 'svelte/store';
import { base } from '$app/paths';
import { authFetch } from '$lib/utils/auth-fetch';
import { createSyncedSettingsService } from '@reborn/storage';
import { localOnly } from '$lib/stores/local-mode.store';

/**
 * App-level singleton of the E2E synced settings service. Wires the shared
 * implementation to this app's `authFetch` (single-flight 401 refresh) and
 * `base` path.
 *
 * `isSyncEnabled` gates out local-only / no-account mode: without it, a settings
 * mutation would PUT /api/settings → 401 → refresh (also 401) → session-expired
 * banner, even though there is no account. Disabled while local-only; re-enabled
 * automatically once the user upgrades (localOnly flips back to false).
 */
export const syncedSettings = createSyncedSettingsService({
	authFetch,
	basePath: base,
	appName: 'reborn-task',
	isSyncEnabled: () => !get(localOnly)
});
