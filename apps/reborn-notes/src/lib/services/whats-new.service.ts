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
 * First run on a device records a baseline silently - new users are not greeted
 * with a changelog. Content is bundled and the check is local: the server never
 * learns the client version or what was viewed (guideline 62 zero-telemetry).
 */
import { browser } from '$app/environment';
import { compareVersions, hasUnseenReleaseNotes } from '@reborn/i18n';
import type { ReleaseApp, ReleasePlatform } from '@reborn/i18n';
import { createLogger } from '@reborn/utils';
import { openWhatsNew } from '$lib/stores/whats-new.svelte';

const logger = createLogger('notes:whats-new');
const LAST_SEEN_KEY = 'whats_new_last_seen';

// Latched only once we have actually opened the dialog (not on a no-op check),
// so re-running the gate after an unlock in the same page load never re-pops a
// dialog the user just closed - while a no-op first run (already up to date)
// does not latch, leaving the door open for a later legitimate open.
let shown = false;

export function maybeShowWhatsNew(app: ReleaseApp, platform: ReleasePlatform): void {
  if (!browser || shown) return;

  const current = __APP_VERSION__;

  let lastSeen: string | null;
  try {
    lastSeen = localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return; // localStorage unavailable - harmless to re-check later
  }

  // First run on this device: record a baseline, don't greet new users.
  if (!lastSeen) {
    safeSet(current);
    return;
  }

  // Nothing newer than what the user has already seen.
  if (compareVersions(current, lastSeen) <= 0) return;

  if (hasUnseenReleaseNotes({ app, platform, lastSeenVersion: lastSeen, currentVersion: current })) {
    shown = true; // latch only on a real open
    logger.info(`Updated to ${current} - opening What's new`);
    openWhatsNew();
  }
  // Advance the baseline so this stays a once-per-update event across loads.
  safeSet(current);
}

function safeSet(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* ignore */
  }
}
