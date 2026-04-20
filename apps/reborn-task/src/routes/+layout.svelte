<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { t, locale } from '$lib/stores/i18n.store';
	import { session } from '$lib/stores/auth.store';
	import { isOnline } from '$lib/stores/network.store';
	import { sessionExpired } from '$lib/stores/session-expired.store';
	import { syncService } from '$lib/services/sync.service';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { SessionExpiredBanner } from '@reborn/ui';
	import LoadingScreen from '$lib/components/LoadingScreen.svelte';
	import { Toaster } from '@reborn/ui';
	import type { Snippet } from 'svelte';
	import { initializeStorage, isDatabaseInitialized } from '@reborn/storage';
	import { cryptoManager } from '@reborn/crypto';
	import { createLogger } from '@reborn/utils';
	import { appSettings } from '$lib/stores/app-settings.store';
	import { taskTitleIndex } from '$lib/services/task-title-index.svelte';
	import { taskCounts } from '$lib/stores/task-counts.store';

	const logger = createLogger('Layout');

	let { children }: { children: Snippet } = $props();

	// Track initialization timeout
	let initTimeout = $state(false);
	// Prevent duplicate initial sync (onMount vs $effect)
	let hasTriggeredInitialSync = $state(false);

	// Update HTML lang attribute when locale changes
	$effect(() => {
		if (browser && $locale) {
			document.documentElement.lang = $locale;
		}
	});

	// Reset sync flag when user logs out — allows re-sync for next login.
	// Defensive: even though logout now uses hard redirect (which clears all
	// in-memory state), this handles edge cases like internal navigation.
	$effect(() => {
		if (browser && $session?.isInitialized && !$session?.isAuthenticated) {
			hasTriggeredInitialSync = false;
		}
	});

	// Re-decrypt stores and pull from server when E2E key becomes available.
	// Covers cross-app login (storage event → /auth/unlock → E2E unlocked) and
	// any other path where hasE2E flips to true after layout already mounted.
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
					logger.debug('Tab became visible — running periodic sync');
					syncService.periodicSync().catch((error) => {
						logger.error('Visibility sync failed:', error);
					});
				}
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);

		const init = async () => {
			// i18n is initialized in +layout.ts (before render) — no need to repeat here

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

					// Force refresh of all stores after initialization
					const { taskStore, listStore, subtaskStore } = await import('@reborn/storage');
					await Promise.all([
						taskStore.refreshItems(),
						listStore.refreshItems(),
						subtaskStore.refreshItems()
					]);
					logger.info('All stores refreshed after initialization');

					// Also refresh decrypted stores
					const { refreshDecryptedLists } = await import('$lib/stores/decrypted-lists.store');
					const { refreshDecryptedSubtasks } = await import('$lib/stores/decrypted-subtasks.store');
					await Promise.all([refreshDecryptedLists(), refreshDecryptedSubtasks()]);
					logger.info('Decrypted stores refreshed');
					// Build task index cache (blocking — stores read from index)
					await taskTitleIndex.build();
					// E2E already active on mount → prevent $effect from duplicating sync
					if (cryptoManager.isInitialized()) hasTriggeredInitialSync = true;
				} catch (error: unknown) {
					logger.error('Failed to initialize database:', error);
				}
			} else {
				logger.info('Database already initialized');

				// Refresh decrypted stores on mount even if database was already initialized
				const { refreshDecryptedLists } = await import('$lib/stores/decrypted-lists.store');
				const { refreshDecryptedSubtasks } = await import('$lib/stores/decrypted-subtasks.store');

				await Promise.all([refreshDecryptedLists(), refreshDecryptedSubtasks()]);
				logger.info('Decrypted stores refreshed on mount');
				// Build task index cache (blocking — stores read from index)
				await taskTitleIndex.build();
				// E2E already active on mount → prevent $effect from duplicating sync
				if (cryptoManager.isInitialized()) hasTriggeredInitialSync = true;
			}

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
			unsubscribe();
		};
	});
</script>

<svelte:head>
	<title>re/task</title>
	<meta name="description" content="Zero-knowledge task management with E2E encryption" />
	<link rel="icon" type="image/svg+xml" href="{base}/favicon.svg" />
</svelte:head>

{#if $session?.isInitialized || initTimeout}
	<SessionExpiredBanner
		visible={$sessionExpired && navigator.onLine}
		username={$session?.user?.username ?? ''}
		onReAuth={(password) => authOperationsService.reAuthenticate(password)}
	/>
	<div class="svelte-app-ready min-h-screen bg-background text-foreground transition-colors">
		{#if children}
			{@render children()}
		{/if}
	</div>
	<Toaster />
{:else}
	<LoadingScreen />
{/if}
