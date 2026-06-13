<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { PUBLIC_SITE_URL } from '$env/static/public';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { goto } from '$lib/utils/navigation';
	import { page } from '$app/stores';
	import { t } from '$lib/stores/i18n.store';
	import { locale } from 'svelte-i18n';
	import { get } from 'svelte/store';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { isLocalOnly } from '$lib/stores/auth.store';
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

		// Upgrade path: a local-only session is creating its first account. Adopt
		// the existing local master key (wrap it with the new password) instead of
		// generating a fresh one, so offline tasks - already encrypted with that
		// key - stay readable and just start syncing. See plan B1.
		const isUpgrade = get(isLocalOnly) && cryptoManager.isInitialized();

		try {
			// 1. Build the registration payload (client-side, Zero Knowledge).
			const passwordHash = await hashPassword(detail.password);
			let encryptedMasterKey: string;
			let masterKeySalt: string;
			let defaultTaskList:
				| { id: string; name_encrypted: string; is_default: true }
				| undefined;

			if (isUpgrade) {
				const localKey = cryptoManager.getCurrentKey();
				if (!localKey) throw new Error('Local master key unavailable for account upgrade');
				const wrapped = await cryptoManager.encryptMasterKey(localKey, detail.password);
				encryptedMasterKey = wrapped.encryptedMasterKey;
				masterKeySalt = wrapped.salt;
				// No defaultTaskList on upgrade: the user already has local lists that
				// adopt into the account (the local default list becomes the account
				// default on push). Sending one would create a duplicate default.
				defaultTaskList = undefined;
			} else {
				const prepared = await prepareRegistrationData(detail.username, detail.password);
				encryptedMasterKey = prepared.encryptedMasterKey;
				masterKeySalt = prepared.masterKeySalt;
				defaultTaskList = prepared.defaultTaskList;
			}

			// 2. Call register API — user (+ default task list for fresh accounts)
			//    created atomically on server.
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/register`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					username: detail.username,
					passwordHash,
					encryptedMasterKey,
					masterKeySalt,
					website: detail.website,
					_t: detail._t,
					powChallenge: detail.powChallenge,
					powSolution: detail.powSolution,
					defaultTaskList
				})
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				error = data.error || 'Registration failed';
				return;
			}

			if (isUpgrade) {
				// 3a. Promote the local session to the new account WITHOUT the login
				//     path (whose onStorageInit clears IndexedDB and would wipe the
				//     very local tasks we are adopting).
				await authOperationsService.completeLocalUpgrade({
					user: data.data.user,
					accessToken: data.data.access_token,
					encryptedMasterKey,
					masterKeySalt
				});
				await goto(returnTo);
			} else if (data.data?.access_token) {
				// 3b. Fresh account: auto-login (re-loads the key after auth).
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

<RegisterPage
	{loading}
	{error}
	appName="re/task"
	header={logoHeader}
	showLoginLink={true}
	loginUrl="/auth/login"
	showLocalModeLink={true}
	powEndpoint="{PUBLIC_BASE_PATH}/api/auth/pow"
	{termsUrl}
	{privacyUrl}
	themeStorageKey="reborn-task-theme"
	onregister={handleRegister}
	onlocalmode={handleLocalMode}
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
