import { writable } from 'svelte/store';

/**
 * Tracks the last error from server-side push schedule sync.
 *
 * `syncScheduledNotifications` runs on background triggers (task changes,
 * visibility, timers) where errors are caught and logged - the user would
 * otherwise have no idea their schedules failed to register. The settings
 * page reads this store to surface a banner so the user can retry / report.
 *
 * Set via `pushSyncError.set('Schedule sync failed: 429')`, cleared with
 * `pushSyncError.set(null)` on the next successful sync.
 */
export const pushSyncError = writable<string | null>(null);
