/**
 * Service Worker Update Detection
 *
 * When a new service worker version is deployed, the browser fetches and installs
 * it in the background. Because our SW calls `skipWaiting()` during install, the
 * new SW takes control immediately — but the currently-loaded page is still
 * running the OLD JS bundle. To avoid serving stale code indefinitely, we:
 *
 *   1. Listen for `updatefound` on the registration to detect incoming updates.
 *   2. When the new worker reaches `installed` state AND there was already a
 *      controller (i.e. this is NOT the first install), prompt the user to
 *      reload via a toast with an "Odśwież" action.
 *   3. Poll `registration.update()` every hour to catch updates in long-lived
 *      tabs (otherwise the browser only checks on navigation).
 *
 * We intentionally do NOT auto-reload — a forced reload would interrupt
 * in-progress edits/encryption. The toast stays visible until the user
 * explicitly dismisses or reloads.
 */

import { browser } from '$app/environment';
import { toastStore } from '@reborn/ui';
import { createLogger } from '@reborn/utils';

const logger = createLogger('SwUpdateService');

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let started = false;
let alreadyPrompted = false;

export function startSwUpdateWatcher(): void {
  if (!browser || started) return;
  if (!('serviceWorker' in navigator)) return;
  started = true;

  void init();
}

async function init(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;

    // Handle both cases: the installing worker may exist at the time
    // `ready` resolves, or the browser may fire `updatefound` later.
    if (registration.installing) {
      trackInstalling(registration.installing);
    }
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) trackInstalling(newWorker);
    });

    // Periodic check — catches updates in tabs that stay open for hours.
    setInterval(() => {
      registration.update().catch((err) => {
        logger.debug('Periodic SW update check failed', err);
      });
    }, UPDATE_CHECK_INTERVAL_MS);

    logger.info('SW update watcher started');
  } catch (error: unknown) {
    logger.error('Failed to start SW update watcher', error);
  }
}

function trackInstalling(worker: ServiceWorker): void {
  worker.addEventListener('statechange', () => {
    if (worker.state !== 'installed') return;
    // No controller means this is the first-ever install — nothing stale
    // to replace, so no need to prompt the user.
    if (!navigator.serviceWorker.controller) return;

    promptReload();
  });
}

function promptReload(): void {
  if (alreadyPrompted) return;
  alreadyPrompted = true;

  logger.info('New service worker version available — prompting user to reload');

  toastStore.info('Nowa wersja aplikacji jest dostępna', {
    description: 'Odśwież stronę, aby załadować najnowszą wersję.',
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: 'Odśwież',
      onClick: () => window.location.reload()
    }
  });
}
