import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';

const logger = createLogger('InactivityTimer');

/**
 * Client-side inactivity timer for auto-logout
 * Default timeout: 30 minutes
 */

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'pointerdown'
];

// Use globalThis for HMR safety
declare global {
  var __inactivityTimer: ReturnType<typeof setTimeout> | undefined;
  var __inactivityListenersAttached: boolean | undefined;
}

let onTimeoutCallback: (() => void) | null = null;

function resetTimer() {
  if (globalThis.__inactivityTimer) {
    clearTimeout(globalThis.__inactivityTimer);
  }

  globalThis.__inactivityTimer = setTimeout(() => {
    logger.info('Inactivity timeout reached, triggering auto-logout');
    if (onTimeoutCallback) {
      onTimeoutCallback();
    }
  }, INACTIVITY_TIMEOUT_MS);
}

function handleActivity() {
  resetTimer();
}

/**
 * Start the inactivity timer
 * @param onTimeout - callback to execute when timeout is reached (e.g., logout)
 */
export function startInactivityTimer(onTimeout: () => void): void {
  if (!browser) return;

  onTimeoutCallback = onTimeout;

  // Attach event listeners only once
  if (!globalThis.__inactivityListenersAttached) {
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, handleActivity, { passive: true });
    }
    globalThis.__inactivityListenersAttached = true;
    logger.debug('Inactivity timer listeners attached');
  }

  resetTimer();
  logger.debug('Inactivity timer started (30 min)');
}

/**
 * Stop the inactivity timer and remove listeners
 */
export function stopInactivityTimer(): void {
  if (!browser) return;

  if (globalThis.__inactivityTimer) {
    clearTimeout(globalThis.__inactivityTimer);
    globalThis.__inactivityTimer = undefined;
  }

  if (globalThis.__inactivityListenersAttached) {
    for (const event of ACTIVITY_EVENTS) {
      document.removeEventListener(event, handleActivity);
    }
    globalThis.__inactivityListenersAttached = false;
  }

  onTimeoutCallback = null;
  logger.debug('Inactivity timer stopped');
}
