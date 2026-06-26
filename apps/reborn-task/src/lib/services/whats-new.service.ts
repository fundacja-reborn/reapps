/**
 * "What's new" post-update auto-open.
 *
 * Called once the app is unlocked and showing content - the caller gates on
 * auth/unlock state, so the dialog never opens over a lock or auth screen. We
 * compare the running __APP_VERSION__ against the last version the user has
 * already seen release notes for; if it is newer AND there is user-facing
 * content for this app + platform in the gap, we open the What's new dialog
 * directly (no intermediate toast).
 *
 * The stored "last seen" is advanced only once we have acted, so the dialog
 * opens at most once per update and is never burned while the app is still
 * locked - we simply get called again after unlock.
 *
 * The baseline is scoped per app: Task and Notes share a browser origin, so a
 * single shared key let whichever app loaded first advance it and suppress the
 * other app's dialog even when each had its own notes. The pre-per-app key is
 * migrated on first read and dropped once both apps hold their own baseline.
 *
 * First run on a device records a baseline silently - new users are not greeted
 * with a changelog. Content is bundled and the check is local: the server never
 * learns the client version or what was viewed (guideline 62 zero-telemetry).
 */
import { browser } from '$app/environment';
import { compareVersions, hasUnseenReleaseNotes } from '@reborn/i18n';
import type { ReleaseApp, ReleasePlatform } from '@reborn/i18n';
import { createLogger } from '@reborn/utils';
import { openWhatsNew } from '$lib/stores/whats-new.svelte';

const logger = createLogger('task:whats-new');

// Pre-per-app shared key (Task + Notes used the same one on this origin).
const LEGACY_KEY = 'whats_new_last_seen';
// Per-app baseline key, e.g. "whats_new_last_seen_task".
const baselineKey = (app: ReleaseApp) => `whats_new_last_seen_${app}`;
// Apps sharing this browser origin. Used only to decide when the legacy shared
// key can be safely dropped: once every app holds its own baseline, none still
// needs the legacy value to migrate. Keep in sync with ReleaseApp - an extra
// entry only delays cleanup, a missing one risks dropping the key too early.
const ORIGIN_APPS: ReleaseApp[] = ['notes', 'task'];

// Latched only once we have actually opened the dialog (not on a no-op check),
// so re-running the gate after an unlock in the same page load never re-pops a
// dialog the user just closed - while a no-op first run (already up to date)
// does not latch, leaving the door open for a later legitimate open.
let shown = false;

export function maybeShowWhatsNew(app: ReleaseApp, platform: ReleasePlatform): void {
  if (!browser || shown) return;

  const current = __APP_VERSION__;
  const key = baselineKey(app);

  let lastSeen: string | null;
  try {
    lastSeen = localStorage.getItem(key);
    // Migrate the pre-per-app shared baseline on first read after the rename, so
    // the release shipping this fix still surfaces each app's own notes instead
    // of being swallowed by a fresh "first run" baseline.
    if (lastSeen === null) lastSeen = localStorage.getItem(LEGACY_KEY);
  } catch {
    return; // localStorage unavailable - harmless to re-check later
  }

  // First run on this device: record a baseline, don't greet new users.
  if (!lastSeen) {
    safeSet(key, current);
    return;
  }

  // Nothing newer than what the user has already seen. Still persist the
  // (possibly migrated) baseline into the per-app key, so the legacy fallback is
  // not re-read every load and cleanup can proceed.
  if (compareVersions(current, lastSeen) <= 0) {
    safeSet(key, lastSeen);
    return;
  }

  if (hasUnseenReleaseNotes({ app, platform, lastSeenVersion: lastSeen, currentVersion: current })) {
    shown = true; // latch only on a real open
    logger.info(`Updated to ${current} - opening What's new`);
    openWhatsNew();
  }
  // Advance the baseline so this stays a once-per-update event across loads.
  safeSet(key, current);
}

function safeSet(key: string, version: string): void {
  try {
    localStorage.setItem(key, version);
    // Drop the legacy shared key only once every origin app holds its own
    // baseline - removing it sooner would deny the other app the value it needs
    // to migrate. Until then the orphan is harmless (one short string), and for
    // a user who only ever opens one app it correctly lingers for the other.
    if (ORIGIN_APPS.every((a) => localStorage.getItem(baselineKey(a)) !== null)) {
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* ignore */
  }
}
