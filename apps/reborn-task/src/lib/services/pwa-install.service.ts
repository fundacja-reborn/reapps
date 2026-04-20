/**
 * PWA Install Prompt Service
 *
 * Encourages users to install the app as a PWA by showing a dismissable toast
 * after login. Works differently per platform:
 *
 *   - **Chromium** (Chrome, Edge, Samsung Internet): Intercepts the native
 *     `beforeinstallprompt` event, defers it, and shows a toast with an
 *     "Install" button that triggers the native install dialog.
 *
 *   - **iOS Safari**: No `beforeinstallprompt` support. Shows a toast with
 *     manual instructions ("Tap Share → Add to Home Screen").
 *
 *   - **Firefox**: No PWA install support — no prompt shown.
 *
 * Conditions for showing the prompt (ALL must be true):
 *   1. App is running in a browser (not already installed as standalone)
 *   2. User is authenticated (checked via `reborn_auth_credentials` in localStorage)
 *   3. User hasn't dismissed the prompt in the last 30 days
 *   4. User hasn't already installed the app
 *   5. At least 5 seconds have passed since page load
 *
 * The prompt uses the same toast system as SW update notifications.
 * LocalStorage keys are prefixed per-app to avoid cross-app conflicts.
 */

import { browser } from '$app/environment';
import { toastStore } from '@reborn/ui';
import { createLogger } from '@reborn/utils';
import { t, initI18n } from '$lib/stores/i18n.store';
import { get } from 'svelte/store';

const logger = createLogger('PwaInstallService');

const STORAGE_PREFIX = 'reborn-task-pwa';
const DISMISSED_KEY = `${STORAGE_PREFIX}-install-dismissed-at`;
const INSTALLED_KEY = `${STORAGE_PREFIX}-installed`;
const CREDENTIALS_KEY = 'reborn_auth_credentials';

const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PROMPT_DELAY_MS = 5_000; // 5 seconds after page load
const TOAST_DURATION_MS = 60_000; // 60 seconds

let started = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function startPwaInstallPrompt(): void {
	if (!browser || started) return;
	started = true;

	// Already running as installed PWA — nothing to do
	if (isStandalone()) {
		logger.debug('App is running in standalone mode — skipping install prompt');
		return;
	}

	// Listen for the native install prompt (Chromium only)
	window.addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault(); // Suppress the default mini-infobar on Android
		deferredPrompt = e as BeforeInstallPromptEvent;
		logger.debug('beforeinstallprompt event captured');
		tryShowPrompt();
	});

	// Track successful installation
	window.addEventListener('appinstalled', () => {
		logger.info('App installed successfully');
		deferredPrompt = null;
		try {
			localStorage.setItem(INSTALLED_KEY, 'true');
		} catch {
			// localStorage might be unavailable
		}
	});

	// Schedule the prompt check after delay
	setTimeout(() => tryShowPrompt(), PROMPT_DELAY_MS);
}

function isStandalone(): boolean {
	if (window.matchMedia('(display-mode: standalone)').matches) return true;
	// iOS Safari standalone check
	if ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone) return true;
	return false;
}

function isIOS(): boolean {
	return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
}

function isAuthenticated(): boolean {
	try {
		return localStorage.getItem(CREDENTIALS_KEY) !== null;
	} catch {
		return false;
	}
}

function wasDismissedRecently(): boolean {
	try {
		const dismissedAt = localStorage.getItem(DISMISSED_KEY);
		if (!dismissedAt) return false;
		return Date.now() - Number(dismissedAt) < DISMISS_COOLDOWN_MS;
	} catch {
		return false;
	}
}

function wasAlreadyInstalled(): boolean {
	try {
		return localStorage.getItem(INSTALLED_KEY) === 'true';
	} catch {
		return false;
	}
}

function markDismissed(): void {
	try {
		localStorage.setItem(DISMISSED_KEY, String(Date.now()));
	} catch {
		// non-critical
	}
}

async function tryShowPrompt(): Promise<void> {
	if (isStandalone()) return;
	if (!isAuthenticated()) return;
	if (wasDismissedRecently()) return;
	if (wasAlreadyInstalled()) return;

	await initI18n();

	if (deferredPrompt) {
		showChromiumPrompt();
	} else if (isIOS()) {
		showIOSPrompt();
	}
	// Firefox / other browsers without install support — no prompt
}

function showChromiumPrompt(): void {
	if (!deferredPrompt) return;

	logger.info('Showing PWA install prompt (Chromium)');
	const $t = get(t);

	toastStore.info($t('pwa.install_title_task'), {
		description: $t('pwa.install_description_task'),
		duration: TOAST_DURATION_MS,
		action: {
			label: $t('pwa.install_button'),
			onClick: () => {
				if (!deferredPrompt) return;
				deferredPrompt
					.prompt()
					.then((result) => {
						logger.info(`Install prompt outcome: ${result.outcome}`);
						if (result.outcome === 'dismissed') {
							markDismissed();
						}
						deferredPrompt = null;
					})
					.catch((err) => {
						logger.error('Install prompt failed', err);
						deferredPrompt = null;
					});
			}
		}
	});

	// If user lets the toast expire without clicking, treat as dismissal
	setTimeout(() => {
		if (deferredPrompt) {
			markDismissed();
		}
	}, TOAST_DURATION_MS + 500);
}

function showIOSPrompt(): void {
	logger.info('Showing PWA install prompt (iOS)');
	const $t = get(t);

	toastStore.info($t('pwa.install_title_task'), {
		description: $t('pwa.install_ios_description'),
		duration: TOAST_DURATION_MS
	});

	setTimeout(() => markDismissed(), TOAST_DURATION_MS + 500);
}
