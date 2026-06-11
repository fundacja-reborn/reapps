import { writable } from 'svelte/store';
import type { UpdateSeverity } from '$lib/utils/app-update';

export interface AppUpdateState {
  severity: UpdateSeverity;
  storeUrl: string | null;
}

/**
 * Result of the native min-version check (native-app-update.ts, Faza 5 plan
 * D5). Stays at 'ok' forever on web: the checker only runs inside the native
 * shell and the blocker markup in +layout.svelte is native-gated, so the web
 * bundle dead-code-eliminates both.
 */
export const appUpdateStore = writable<AppUpdateState>({ severity: 'ok', storeUrl: null });
