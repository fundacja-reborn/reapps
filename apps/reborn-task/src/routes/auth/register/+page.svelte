<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { PUBLIC_SITE_URL } from '$env/static/public';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { goto } from '$lib/utils/navigation';
	import { page } from '$app/stores';
	import { t } from '$lib/stores/i18n.store';
	import { locale } from 'svelte-i18n';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { RegisterPage } from '@reborn/ui';
	import { hashPassword, generateMasterKeyForUser, cryptoManager } from '@reborn/crypto';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('task:register');

	let returnTo = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	const siteUrl = PUBLIC_SITE_URL || '';
	const termsUrl = $derived(siteUrl ? `${siteUrl}${$locale !== 'en' ? '/' + $locale : ''}/terms` : '');
	const privacyUrl = $derived(siteUrl ? `${siteUrl}${$locale !== 'en' ? '/' + $locale : ''}/privacy` : '');

	$effect(() => {
		if (browser) {
			// Get return URL from query params
			const url = new URL($page.url);
			returnTo = url.searchParams.get('returnTo') || '/all';
		}
	});

	/**
	 * Prepare registration data on client side
	 * This ensures all sensitive operations happen in the browser
	 */
	async function prepareRegistrationData(username: string, password: string) {
		try {
			logger.info('Preparing registration data client-side');

			// 1. Hash password on client side
			const passwordHash = await hashPassword(password);
			logger.debug('Password hashed successfully');

			// 2. Generate master key for encryption
			const { encryptedMasterKey, salt: masterKeySalt } = await generateMasterKeyForUser(password);
			logger.debug('Master key generated and encrypted');

			// 3. Load master key to encrypt default task list name
			await cryptoManager.loadUserMasterKey(encryptedMasterKey, masterKeySalt, password);

			// 4. Create encrypted default task list
			const defaultListName = $t('taskList.default') || 'My Tasks';
			const nameEncrypted = await cryptoManager.encryptText(defaultListName);
			const defaultTaskList = {
				id: crypto.randomUUID(),
				name_encrypted: nameEncrypted,
				is_default: true as const
			};

			// 5. Clear master key — login flow will re-load it
			cryptoManager.clearMasterKey();

			return {
				username,
				passwordHash,
				encryptedMasterKey,
				masterKeySalt,
				defaultTaskList
			};
		} catch (error: unknown) {
			logger.error('Failed to prepare registration data:', error);
			throw new Error('Failed to prepare registration data', { cause: error });
		}
	}

	async function handleRegister(detail: {
		username: string;
		password: string;
		website?: string;
		_t?: number;
		powChallenge?: string;
		powSolution?: number;
	}) {
		loading = true;
		error = null;

		try {
			// 1. Prepare registration data client-side (hash password, generate keys, encrypt default list)
			const registrationData = await prepareRegistrationData(detail.username, detail.password);

			// 2. Call register API — user + default task list created atomically on server
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/register`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					username: registrationData.username,
					passwordHash: registrationData.passwordHash,
					encryptedMasterKey: registrationData.encryptedMasterKey,
					masterKeySalt: registrationData.masterKeySalt,
					website: detail.website,
					_t: detail._t,
					powChallenge: detail.powChallenge,
					powSolution: detail.powSolution,
					defaultTaskList: registrationData.defaultTaskList
				})
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				error = data.error || 'Registration failed';
				return;
			}

			// 3. Log the user in automatically
			if (data.data?.access_token) {
				await authOperationsService.login(detail.username, detail.password);
				await goto(returnTo);
			}
		} catch (err: unknown) {
			error = 'An error occurred. Please try again.';
			logger.error('Registration error:', err);
		} finally {
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

<RegisterPage
	{loading}
	{error}
	appName="re/task"
	header={logoHeader}
	showLoginLink={true}
	loginUrl="/auth/login"
	powEndpoint="{PUBLIC_BASE_PATH}/api/auth/pow"
	{termsUrl}
	{privacyUrl}
	themeStorageKey="reborn-task-theme"
	onregister={handleRegister}
	onerror={(msg) => {
		error = msg;
	}}
	onnavigate={(e) => {
		if (e.url === '/auth/login' && returnTo && returnTo !== '/all') {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local temp variable
			const params = new URLSearchParams();
			params.set('returnTo', returnTo);
			const query = params.toString();
			goto(`/auth/login${query ? `?${query}` : ''}`);
		} else {
			goto(e.url);
		}
	}}
/>
