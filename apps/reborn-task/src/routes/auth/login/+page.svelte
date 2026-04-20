<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { goto } from '$lib/utils/navigation';
	import { page } from '$app/stores';
	import { t } from '$lib/stores/i18n.store';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { LoginPage } from '@reborn/ui';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('LoginRoute');

	let returnTo = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (browser) {
			// Get return URL from query params
			const url = new URL($page.url);
			returnTo = url.searchParams.get('returnTo') || '/all';
		}
	});

	async function handleLogin(detail: { username: string; password: string; rememberMe: boolean }) {
		loading = true;
		error = null;

		try {
			logger.debug('Starting login process for:', detail.username);

			// Use the auth operations service
			const result = await authOperationsService.login(detail.username, detail.password);

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
				sessionStorage.setItem('2fa_pending_password', detail.password);
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
	themeStorageKey="reborn-task-theme"
	onlogin={handleLogin}
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
