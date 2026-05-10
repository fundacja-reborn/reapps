<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$lib/utils/navigation';
	import { page } from '$app/stores';
	import { UnlockPage } from '@reborn/ui';
	import { session } from '$lib/stores/auth.store';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { browser } from '$app/environment';
	import { cryptoManager } from '@reborn/crypto';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('UnlockRoute');

	let loading = $state(false);
	let error = $state<string | null>(null);
	let attemptsRemaining = $state<number | undefined>(undefined);
	let username = $state('');
	let isRedirecting = false;
	// Guard: prevent $effect from racing with handleUnlock().
	// When unlockE2E() sets hasE2E=true internally, the reactive $effect would
	// see hasE2E and call goto() BEFORE unlockE2E() finishes awaiting initialSync().
	// This flag blocks that premature redirect.
	let isUnlocking = $state(false);

	// Get return URL from query params
	const returnTo = $derived.by(() => {
		return $page.url.searchParams.get('returnTo') || '/';
	});

	$effect(() => {
		if (browser && !isRedirecting && !isUnlocking) {
			checkAuthState();
		}
	});

	async function checkAuthState() {
		// Prevent multiple checks
		if (isRedirecting) {
			return;
		}

		const currentSession = $session;

		// Wait until the session store has finished bootstrapping. Without this
		// guard the first reactive pass sees {isInitialized:false, isAuthenticated:false}
		// and bounces to /auth/login before initializeAuth() has even populated
		// the store — producing the offline redirect loop.
		if (!currentSession.isInitialized || currentSession.isLoading) {
			return;
		}

		// If user is not authenticated, redirect to login
		if (!currentSession.isAuthenticated) {
			logger.debug('User not authenticated, redirecting to login');
			isRedirecting = true;
			await goto(
				'/auth/login' + (returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : '')
			);
			return;
		}

		// Fast-path for cross-app SSO: shared origin IDB may already hold the
		// master key (peer Notes unlocked it, or initializeAuth() raced this
		// $effect). waitForRestore() resolves with a 5s fail-soft timeout, so
		// the password form still appears if IDB is genuinely empty/slow.
		if (!currentSession.hasE2E) {
			await cryptoManager.waitForRestore();
			if (cryptoManager.isInitialized()) {
				logger.info('Master key found in shared IDB — skipping password prompt');
				authOperationsService.getSessionManager().setSession({ hasE2E: true });
				isRedirecting = true;
				await goto(returnTo);
				return;
			}
		}

		// If user already has E2E unlocked, redirect to return URL
		if (currentSession.hasE2E) {
			logger.debug('E2E already unlocked, redirecting to:', returnTo);
			isRedirecting = true;
			await goto(returnTo);
			return;
		}

		// Get username from session
		if (currentSession.user?.username) {
			username = currentSession.user.username;
		}
	}

	async function handleUnlock(password: string) {
		loading = true;
		error = null;
		isUnlocking = true;

		try {
			const result = await authOperationsService.unlockE2E(password);

			if (result.success) {
				logger.info('E2E unlocked successfully');
				// Set flag to prevent double redirect
				isRedirecting = true;
				// Redirect to the intended destination
				await goto(returnTo);
			} else {
				error = result.message || 'Failed to unlock';
				attemptsRemaining = result.attemptsRemaining;
				isUnlocking = false;
			}
		} catch (err: unknown) {
			logger.error('Unlock error:', err);
			error = err instanceof Error ? err.message : 'Failed to unlock';
			isUnlocking = false;
		} finally {
			loading = false;
		}
	}

	async function handleLogout() {
		loading = true;

		try {
			await authOperationsService.logout();
			// Navigation is handled by logout function
		} catch (err: unknown) {
			logger.error('Logout error:', err);
			error = err instanceof Error ? err.message : 'Failed to logout';
			loading = false;
		}
	}
</script>

{#snippet logoHeader()}
	<img src="{base}/logo-black.svg" alt="re/task" class="h-6 w-auto block dark:hidden" />
	<img
		src="{base}/logo-white.svg"
		alt="re/task"
		class="h-6 w-auto hidden dark:block dark:opacity-80"
	/>
{/snippet}

<UnlockPage
	{username}
	{loading}
	{error}
	{attemptsRemaining}
	header={logoHeader}
	onUnlock={handleUnlock}
	onLogout={handleLogout}
>
	{#snippet footer()}
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Having trouble? You can also
			<button
				onclick={handleLogout}
				class="font-medium text-primary hover:text-primary/80 underline"
			>
				sign out and log in again
			</button>
		</p>
	{/snippet}
</UnlockPage>
