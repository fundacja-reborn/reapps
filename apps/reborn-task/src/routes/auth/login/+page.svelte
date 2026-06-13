<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { goto } from '$lib/utils/navigation';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { t } from '$lib/stores/i18n.store';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { sessionExpired } from '$lib/stores/session-expired.store';
	import { isLocalOnly } from '$lib/stores/auth.store';
	import { LoginPage } from '@reborn/ui';
	import ConfirmDialog from '$lib/components/shared/dialogs/ConfirmDialog.svelte';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('LoginRoute');

	let returnTo = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Local-only mode: signing into an existing account runs clearAllUserData
	// (onStorageInit context='login'), replacing on-device tasks. Confirm before
	// that wipe so the user can export a backup instead of losing data silently.
	let confirmReplaceOpen = $state(false);
	let pendingLogin = $state<{ username: string; password: string } | null>(null);

	$effect(() => {
		if (browser) {
			// Get return URL from query params
			const url = new URL($page.url);
			returnTo = url.searchParams.get('returnTo') || '/all';
			// Reaching the login page = there's no live session to expire.
			// Belt-and-suspenders cleanup so the banner never lingers when
			// a non-standard path dropped us here (cross-app logout, etc.).
			sessionExpired.set(false);
		}
	});

	async function handleLogin(detail: { username: string; password: string; rememberMe: boolean }) {
		if (get(isLocalOnly)) {
			pendingLogin = { username: detail.username, password: detail.password };
			confirmReplaceOpen = true;
			return;
		}
		await performLogin(detail.username, detail.password);
	}

	async function performLogin(username: string, password: string) {
		loading = true;
		error = null;

		try {
			logger.debug('Starting login process for:', username);

			// Use the auth operations service
			const result = await authOperationsService.login(username, password);

			if (!result || !result.success) {
				loading = false;
				error = result?.message || 'Login failed';
				return;
			}

			// Handle 2FA if required
			if (result.twoFactorRequired) {
				logger.info('2FA required, redirecting...');
				loading = false;
				// Save password temporarily for E2E decryption after 2FA verification
				sessionStorage.setItem('2fa_pending_password', password);
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local temp variable
				const params = new URLSearchParams({
					userId: result.userId || '',
					returnTo: returnTo
				});
				if (result.encryptedMasterKey) {
					params.set('emk', result.encryptedMasterKey);
				}
				if (result.masterKeySalt) {
					params.set('ms', result.masterKeySalt);
				}
				await goto(`/auth/2fa?${params.toString()}`);
				return;
			}

			// Login successful — navigate to the return URL.
			// Auth layout's $effect has a $navigating guard, so it will NOT fire a
			// competing goto() while this navigation is in progress.
			logger.info('Login successful, redirecting to:', returnTo);
			await goto(returnTo, { replaceState: true });
		} catch (err: unknown) {
			logger.error('Login error:', err);
			error = err instanceof Error ? err.message : 'An error occurred. Please try again.';
			loading = false;
		}
	}

	async function handleLocalMode() {
		loading = true;
		error = null;
		const ok = await authOperationsService.enterLocalMode();
		if (ok) {
			await goto('/all');
			return;
		}
		error = $t('local_mode.enter_failed');
		loading = false;
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

<LoginPage
	{loading}
	{error}
	appName="re/task"
	header={logoHeader}
	showRegisterLink={true}
	registerUrl="/auth/register"
	showLocalModeLink={true}
	themeStorageKey="reborn-task-theme"
	onlogin={handleLogin}
	onlocalmode={handleLocalMode}
	onnavigate={(e) => {
		if (e.url === '/auth/register' && returnTo && returnTo !== '/all') {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local temp variable
			const params = new URLSearchParams();
			params.set('returnTo', returnTo);
			const query = params.toString();
			goto(`/auth/register${query ? `?${query}` : ''}`);
		} else {
			goto(e.url);
		}
	}}
/>

<!-- Local-only safety: signing in replaces on-device tasks - confirm first. -->
<ConfirmDialog
	bind:open={confirmReplaceOpen}
	title={$t('local_mode.replace_title')}
	description={$t('local_mode.replace_desc')}
	confirmText={$t('local_mode.replace_confirm')}
	cancelText={$t('common.cancel')}
	variant="destructive"
	onConfirm={() => {
		if (pendingLogin) return performLogin(pendingLogin.username, pendingLogin.password);
	}}
/>
