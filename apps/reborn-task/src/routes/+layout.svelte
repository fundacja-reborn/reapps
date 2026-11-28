<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { t, locale } from '$lib/stores/i18n.store';
	import { session } from '$lib/stores/auth.store';
	import { isOnline } from '$lib/stores/network.store';
	import { sessionExpired } from '$lib/stores/session-expired.store';
	import { syncService } from '$lib/services/sync.service';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { SessionExpiredBanner, RequireSessionModal } from '@reborn/ui';
	import LocalModeWelcome from '$lib/components/LocalModeWelcome.svelte';
	import { Toaster, WhatsNewDialog } from '@reborn/ui';
	import type { Snippet } from 'svelte';
	import { initializeStorage, isDatabaseInitialized } from '@reborn/storage';
	import { cryptoManager } from '@reborn/crypto';
	import { createLogger } from '@reborn/utils';
	import { appSettings } from '$lib/stores/app-settings.store';
	import { syncedSettings } from '$lib/services/synced-settings.service';
	import { taskTitleIndex } from '$lib/services/task-title-index.svelte';
	import { taskCounts } from '$lib/stores/task-counts.store';
	import { sharesStore } from '$lib/stores/shares.store';
	import { whatsNew } from '$lib/stores/whats-new.svelte';
	import { maybeShowWhatsNew } from '$lib/services/whats-new.service';
	import { applyDocumentLocale, readDirectionOverride } from '@reborn/i18n';
	import { shareDeepLinkToRoute } from '@reborn/platform';
	import { platform } from '$lib/platform';
	import { goto } from '$lib/utils/navigation';
	import { hideNativeSplash } from '$lib/utils/native-shell';
	import { checkNativeUpdateGate } from '$lib/utils/native-app-update';
	import { onReminderTap } from '$lib/services/native-reminders';
	import { initAppLock, lockNow, shouldLockOnResume } from '$lib/services/app-lock.service';
	import UpdateRequiredGate from '$lib/components/layout/UpdateRequiredGate.svelte';

	const logger = createLogger('Layout');

	let { children }: { children: Snippet } = $props();

	// What's new dialog: web-only app, so platform is always 'web'. The website
	// changelog (English + /pl only) backs the "Full changelog" link.
	const SITE_URL = (import.meta.env.PUBLIC_SITE_URL as string | undefined) ?? 'https://reapps.eu';
	const changelogHref = $derived(`${SITE_URL}${$locale === 'pl' ? '/pl' : ''}/changelog`);

	// Track initialization timeout
	let initTimeout = $state(false);

	// Native: drop the held system splash the moment the shell can paint (the
	// app-ready gate below opens). A no-op once hidden; if this never runs, the
	// splash plugin's own launchShowDuration auto-hide is the fallback. The web
	// build folds `__REBORN_NATIVE__` to false and drops the effect body.
	$effect(() => {
		if (!__REBORN_NATIVE__) return;
		if ($session?.isInitialized || initTimeout || isPublicShareRoute) void hideNativeSplash();
	});
	// One-shot guard of the hasE2E effect below, which is the ONLY place that
	// starts the initial pull on a cold start. Only that effect may set it:
	// onMount's init() used to set it too ("E2E already active on mount") without
	// starting a sync, so whenever init() finished before the effect first saw
	// hasE2E, the pull was skipped until the 5-minute periodic sync.
	let hasTriggeredInitialSync = $state(false);

	// Public read-only share view (/s/[slug]) - no auth, no IndexedDB, no sync.
	// Used both to short-circuit init() and to unblock the loading-screen gate
	// (which otherwise waits for $session.isInitialized that never fires for
	// anonymous visitors). See guideline 59 for rationale.
	const isPublicShareRoute = $derived(
		($page?.url?.pathname ?? '').startsWith(`${base || ''}/s/`)
	);

	// Keep <html lang> and <html dir> in sync with the UI locale. The server
	// already rendered both (%lang% / %dir% in app.html), so the first paint is
	// in the right direction; this follows later locale changes. `?dir=rtl`
	// forces RTL for smoke-testing the layout before an RTL locale ships.
	const dirOverride = browser ? readDirectionOverride(window.location.search) : null;
	$effect(() => {
		if (browser && $locale) {
			applyDocumentLocale($locale, dirOverride);
		}
	});

	// Reset sync flag when user logs out - allows re-sync for next login.
	// Defensive: even though logout now uses hard redirect (which clears all
	// in-memory state), this handles edge cases like internal navigation.
	$effect(() => {
		if (browser && $session?.isInitialized && !$session?.isAuthenticated) {
			hasTriggeredInitialSync = false;
		}
	});

	// Native App Lock (soft lock, no page load): the key left memory and hasE2E
	// dropped, so the next biometric unlock must re-decrypt the stores and pull
	// - the same path as after a password unlock. Web locks reload the page.
	$effect(() => {
		if (!__REBORN_NATIVE__) return;
		if (browser && $session?.isInitialized && !$session?.hasE2E) {
			hasTriggeredInitialSync = false;
		}
	});

	// Re-decrypt stores and pull from server when E2E key becomes available.
	// Covers the cold start with a restored key, cross-app login (storage event
	// → /auth/unlock → E2E unlocked) and any other path where hasE2E flips to
	// true after layout already mounted.
	// `$session` can trail the SessionManager: auth.store.ts attaches to it on a
	// 100 ms retry timer, and +layout.ts stops waiting for the auth bootstrap
	// after 3 s. On a fast load this effect therefore first sees hasE2E only
	// after onMount's init() has finished - it must still run then.
	// syncService.initialSync() reuses in-flight promises, so concurrent calls
	// from onStorageInit or unlockE2E safely deduplicate.
	$effect(() => {
		if (!browser || !$session?.hasE2E) return;
		if (hasTriggeredInitialSync) return;

		hasTriggeredInitialSync = true;
		const runSync = async () => {
			if (!isDatabaseInitialized()) {
				await initializeStorage('task');
			}
			const { refreshDecryptedLists } = await import('$lib/stores/decrypted-lists.store');
			const { refreshDecryptedSubtasks } = await import('$lib/stores/decrypted-subtasks.store');

			await Promise.all([refreshDecryptedLists(), refreshDecryptedSubtasks()]);
			await taskTitleIndex.rebuild();

			if (navigator.onLine) {
				// Pull E2E synced settings now that the master key is available.
				// Re-init appSettings so theme/locale reflect the server state.
				try {
					const { applied } = await syncedSettings.pullAndMerge();
					if (applied) await appSettings.refresh();
				} catch (err: unknown) {
					logger.warn('Synced settings pull on E2E unlock failed', err);
				}

				await syncService.initialSync();
				// Refresh all stores after pull from server
				const { taskListStore } = await import('$lib/stores/decrypted-lists.store');
				await taskListStore.loadLists();
				await Promise.all([refreshDecryptedLists(), refreshDecryptedSubtasks()]);
				await taskTitleIndex.rebuild();
				taskCounts.refresh();
			}
		};
		runSync().catch((err) => {
			logger.error('Sync-on-E2E-unlock failed:', err);
		});
	});

	// What's new: auto-open the dialog once the app is unlocked (the E2E key is
	// available, so the user is past login/unlock and looking at content), never
	// over a lock/auth screen. Web-only app -> platform 'web'. maybeShowWhatsNew
	// acts at most once and only advances its baseline when it actually runs.
	$effect(() => {
		if (!browser || !$session?.hasE2E) return;
		maybeShowWhatsNew('task', 'web');
	});

	// Initialize dark mode based on user preference or system setting
	onMount(() => {
		logger.info('Component mounted');

		// Initialize network monitoring (this sets up online/offline listeners)
		const unsubscribe = isOnline.subscribe(() => {});

		// Set timeout to show app even if initialization fails
		// 2 second timeout - enough for database initialization
		const timeoutId = setTimeout(() => {
			logger.info('Initialization timeout - showing app anyway');
			initTimeout = true;
		}, 2000);

		// Set up periodic bidirectional sync every 5 minutes when online
		const syncInterval = setInterval(
			() => {
				if ($session?.isAuthenticated && navigator.onLine) {
					logger.debug('Running periodic sync');
					syncService.periodicSync().catch((error) => {
						logger.error('Periodic sync failed:', error);
					});
				}
			},
			5 * 60 * 1000
		);

		// Sync when user returns to this tab (debounce 30s)
		let lastPeriodicSyncTimestamp = 0;
		const VISIBILITY_SYNC_DEBOUNCE_MS = 30_000;

		const handleVisibilityChange = () => {
			if (
				document.visibilityState === 'visible' &&
				navigator.onLine &&
				$session?.isAuthenticated
			) {
				const now = Date.now();
				if (now - lastPeriodicSyncTimestamp >= VISIBILITY_SYNC_DEBOUNCE_MS) {
					lastPeriodicSyncTimestamp = now;
					logger.debug('Tab became visible - running periodic sync');
					syncService.periodicSync().catch((error) => {
						logger.error('Visibility sync failed:', error);
					});
				}
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);

		// Native shell: no Service Worker drives foreground sync there and the
		// webview may not fire visibilitychange reliably on app switch, so the
		// platform lifecycle resume is the dependable signal - same as re/notes.
		// Native-only -> the whole block is dead-code-eliminated from the web
		// bundle.
		let offResume: (() => void) | undefined;
		let offDeepLink: (() => void) | undefined;
		let offReminderTap: (() => void) | undefined;
		let updateGateTimer: ReturnType<typeof setTimeout> | undefined;
		if (__REBORN_NATIVE__) {
			// App Lock: track background time so a resume past the idle timeout
			// re-locks (wires platform.lifecycle.onPause once).
			initAppLock();

			offResume = platform.lifecycle.onResume(() => {
				// App Lock first: re-lock and show the biometric screen instead of
				// syncing while unlocked. No-op when App Lock is off.
				if (shouldLockOnResume()) {
					lockNow();
					const path = window.location.pathname;
					void goto(`/auth/applock?returnTo=${encodeURIComponent(path)}`);
					return;
				}
				// Min-version gate re-check (throttled internally, fail-open).
				void checkNativeUpdateGate();
				if ($session?.isAuthenticated && navigator.onLine) {
					lastPeriodicSyncTimestamp = Date.now();
					syncService.periodicSync().catch((error) => {
						logger.error('Resume sync failed:', error);
					});
				}
			});

			// Inbound App Links / Universal Links to a public share
			// (https://<host>/task/s/<slug>#k=...): route into the in-app read-only
			// viewer, keeping the key fragment client-side. The URL carries the
			// decryption key, so it is never logged.
			offDeepLink = platform.deepLinks.onOpen((url) => {
				const route = shareDeepLinkToRoute(url);
				if (route) void goto(route);
			});

			// A tapped task reminder (device-local notification) opens its task,
			// also when the tap started the app (the plugin holds it until now).
			offReminderTap = onReminderTap((taskId) => {
				void goto(`/tasks/${encodeURIComponent(taskId)}`);
			});

			// The first min-version check is deferred a few seconds so it never
			// competes with the boot path (guideline 61); later checks ride resume.
			updateGateTimer = setTimeout(() => void checkNativeUpdateGate(), 3000);
		}

		const init = async () => {
			// Public read-only share view (/s/[slug]) bypass: skip auth/storage/sync
			// init entirely. The snapshot page fetches its own ciphertext and decrypts
			// client-side with the URL-fragment key. Without this guard,
			// initializeStorage() would create an empty Reborn_task_DB in the
			// visitor's browser. The theme-flash inline script in app.html has
			// already applied dark/light from localStorage + prefers-color-scheme,
			// so appSettings.init() is also unnecessary. See guideline 59.
			const basePath = base || '';
			if (window.location.pathname.startsWith(`${basePath}/s/`)) {
				return;
			}

			// i18n is initialized in +layout.ts (before render) - no need to repeat here

			// Wait for CryptoManager to restore key from sessionStorage (if any)
			// Without this, refreshDecrypted*() runs before isInitialized() is true
			// and sets decrypted stores to [] (race condition on hard refresh)
			await cryptoManager.waitForRestore();

			// Ensure database is initialized
			if (!isDatabaseInitialized()) {
				logger.info('Database not initialized, initializing now...');
				try {
					await initializeStorage('task');
					logger.info('Database initialized successfully');

					// Force refresh of all stores after initialization.
					// offlineOperationsStore must be refreshed on cold start so its reactive
					// writable reflects rows persisted in IndexedDB - otherwise pending-count
					// indicators show 0 until the first local mutation triggers a refresh.
					const { taskStore, listStore, subtaskStore, offlineOperationsStore } =
						await import('@reborn/storage');
					await Promise.all([
						taskStore.refreshItems(),
						listStore.refreshItems(),
						subtaskStore.refreshItems(),
						offlineOperationsStore.refreshItems()
					]);
					logger.info('All stores refreshed after initialization');

					// Also refresh decrypted stores
					const { refreshDecryptedLists } = await import('$lib/stores/decrypted-lists.store');
					const { refreshDecryptedSubtasks } = await import('$lib/stores/decrypted-subtasks.store');
					await Promise.all([refreshDecryptedLists(), refreshDecryptedSubtasks()]);
					logger.info('Decrypted stores refreshed');

					// If the restored master key doesn't match the ciphertexts in IDB
					// (e.g. cross-app login after account switch), wipe local data and
					// re-pull from server. No-op on the happy path.
					const recovered = await authOperationsService.recoverFromKeyMismatch();
					if (recovered) {
						await Promise.all([refreshDecryptedLists(), refreshDecryptedSubtasks()]);
					}

					// Build task index cache (blocking - stores read from index)
					await taskTitleIndex.build();
				} catch (error: unknown) {
					logger.error('Failed to initialize database:', error);
				}
			} else {
				logger.info('Database already initialized');

				// Refresh decrypted stores on mount even if database was already initialized.
				// Also refresh offlineOperationsStore so pending-count indicators are accurate
				// on cold start (derived stores feed SyncStatusIndicator / SyncStatusFooter).
				const { refreshDecryptedLists } = await import('$lib/stores/decrypted-lists.store');
				const { refreshDecryptedSubtasks } = await import('$lib/stores/decrypted-subtasks.store');
				const { offlineOperationsStore } = await import('@reborn/storage');

				await Promise.all([
					refreshDecryptedLists(),
					refreshDecryptedSubtasks(),
					offlineOperationsStore.refreshItems()
				]);
				logger.info('Decrypted stores refreshed on mount');

				// If the restored master key doesn't match the ciphertexts in IDB
				// (e.g. cross-app login after account switch), wipe local data and
				// re-pull from server. No-op on the happy path.
				const recovered = await authOperationsService.recoverFromKeyMismatch();
				if (recovered) {
					await Promise.all([refreshDecryptedLists(), refreshDecryptedSubtasks()]);
				}

				// Build task index cache (blocking - stores read from index)
				await taskTitleIndex.build();
			}

			// Pull E2E synced settings BEFORE applying theme/locale - so the
			// freshly logged-in / cross-device session sees the user's preferences
			// rather than IDB defaults. Master key must already be unlocked.
			if (cryptoManager.isInitialized()) {
				try {
					await syncedSettings.pullAndMerge();
				} catch (error: unknown) {
					logger.warn('Synced settings pull failed - falling back to local IDB', error);
				}
			}

			// Wire the shares store so the per-task badge / IconNav badge stay in
			// sync across lock/unlock cycles. init() is idempotent and self-guards
			// on crypto.isInitialized(). See guideline 59.
			sharesStore.init();

			// Initialize app settings (includes theme application)
			try {
				await appSettings.init();
				logger.info('App settings initialized');
			} catch (error: unknown) {
				logger.error('Failed to initialize app settings:', error);
				// Fall back to localStorage cache (written by applyTheme)
				const savedTheme = localStorage.getItem('reborn-task-theme');
				const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

				if (savedTheme === 'dark' || (savedTheme !== 'light' && prefersDark)) {
					document.documentElement.classList.add('dark');
				} else {
					document.documentElement.classList.remove('dark');
				}
			}
		};

		init().catch((error) => {
			logger.error('Initialization failed:', error);
		});

		return () => {
			clearTimeout(timeoutId);
			clearInterval(syncInterval);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			if (updateGateTimer) clearTimeout(updateGateTimer);
			offResume?.();
			offDeepLink?.();
			offReminderTap?.();
			unsubscribe();
		};
	});
</script>

<svelte:head>
	<title>re/task</title>
	<meta name="description" content="Zero-knowledge task management with E2E encryption" />
	<link rel="icon" type="image/svg+xml" href="{base}/favicon.svg" />
</svelte:head>

<!-- No {:else} branch: while the session is not yet initialized we render
     nothing, so the static #app-loading overlay from app.html stays visible
     until the content wrapper below (with .svelte-app-ready) mounts and hides
     it via `body:has(.svelte-app-ready) #app-loading`. A second Svelte loader
     here used to swap #app-loading out for a differently styled spinner,
     producing a visible mid-boot flash. -->
{#if $session?.isInitialized || initTimeout || isPublicShareRoute}
	<SessionExpiredBanner
		visible={$sessionExpired && navigator.onLine}
		username={$session?.user?.username ?? ''}
		onReAuth={(password) => authOperationsService.reAuthenticate(password)}
		onVerifyTotp={(challengeToken, code) =>
			authOperationsService.verifyTotpForReauth(challengeToken, code)}
	/>
	<RequireSessionModal
		username={$session?.user?.username ?? ''}
		onReAuth={(password) => authOperationsService.reAuthenticate(password)}
		onVerifyTotp={(challengeToken, code) =>
			authOperationsService.verifyTotpForReauth(challengeToken, code)}
	/>
	<div class="svelte-app-ready min-h-screen bg-background text-foreground transition-colors">
		{#if children}
			{@render children()}
		{/if}
	</div>
	<LocalModeWelcome />
	<Toaster />
	<WhatsNewDialog
		bind:open={whatsNew.open}
		app="task"
		platform="web"
		fullChangelogHref={changelogHref}
	/>
	{#if __REBORN_NATIVE__}
		<UpdateRequiredGate />
	{/if}
{/if}

{#if __REBORN_NATIVE__}
	<!-- Brand strip behind the transparent system status bar (PWA parity: on
	     the installed web app Chrome paints this area from the theme-color
	     meta, #43a047). The shells run edge-to-edge (enforced on Android
	     15+/16; iOS always worked this way), so the bar's "background" is
	     whatever the app draws beneath it - this fixed band, sized by the top
	     safe-area inset (0 in landscape), is that background. Light icons come
	     from native-shell.ts. Rendered outside the app-ready gate so the bar is
	     branded from first paint, and above UpdateRequiredGate (z-100) because
	     it stands in for a system surface. -->
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-[110] h-[env(safe-area-inset-top,0px)] bg-[#43a047]"
		aria-hidden="true"
	></div>
{/if}
