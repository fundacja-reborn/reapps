<script lang="ts">
	// Native App Lock screen (guideline 66): biometric / device-credential
	// unlock of the key held in the device vault. Same screen as re/notes'.
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { goto } from '$lib/utils/navigation';
	import { page } from '$app/stores';
	import { AuthLayout, Button, Alert, AlertDescription } from '@reborn/ui';
	import { Fingerprint, ScanFace, Lock } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { cryptoManager } from '@reborn/crypto';
	import { isAuthenticated } from '$lib/stores/auth.store';
	import { unlock as appLockUnlock, getAppLockAvailability } from '$lib/services/app-lock.service';
	import type { BiometryKind } from '$lib/utils/native-biometric-auth';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('AppLockRoute');

	let loading = $state(false);
	let error = $state<string | null>(null);
	let biometryKind = $state<BiometryKind>('none');
	// Until the device answers, `none` only means "not known yet" - the
	// device-password wording must not flash before "Face ID" replaces it.
	let biometryKnown = $state(false);
	let isRedirecting = false;

	const returnTo = $derived.by(() => $page.url.searchParams.get('returnTo') || '/');

	// A human label for the device's biometry, used in the description.
	const biometryLabel = $derived(
		biometryKind === 'none'
			? $t('app_lock.biometry.generic')
			: $t(`app_lock.biometry.${biometryKind}`)
	);

	onMount(() => {
		// Nothing to unlock (not locked / already unlocked) -> leave.
		if (!cryptoManager.isAppLockLocked()) {
			isRedirecting = true;
			void goto(returnTo);
			return;
		}
		void getAppLockAvailability().then((status) => {
			biometryKind = status.kind;
			biometryKnown = true;
		});
		// Auto-prompt on first paint (the raw-bridge plugin has no nested dynamic
		// import, so it is safe from the cold-start wedge).
		void runUnlock();
	});

	function messageForCode(code: string): string | null {
		switch (code) {
			case 'userCancel':
			case 'systemCancel':
			case 'appCancel':
				// User-initiated cancel - no error noise, just let them retry.
				return null;
			case 'biometryLockout':
				return $t('app_lock.error.lockout');
			case 'biometryNotAvailable':
			case 'biometryNotEnrolled':
			case 'passcodeNotSet':
			case 'noDeviceCredential':
				return $t('app_lock.error.unavailable');
			case 'vaultEmpty':
				return $t('app_lock.error.vault');
			default:
				return $t('app_lock.error.failed');
		}
	}

	async function runUnlock() {
		if (loading || isRedirecting) return;
		loading = true;
		error = null;
		try {
			const result = await appLockUnlock({
				reason: $t('app_lock.prompt.reason'),
				cancelTitle: $t('app_lock.prompt.cancel'),
				androidTitle: $t('app_lock.prompt.android_title'),
				androidSubtitle: $t('app_lock.prompt.android_subtitle'),
				iosFallbackTitle: ''
			});
			if (result.ok) {
				isRedirecting = true;
				await goto(returnTo);
				return;
			}
			error = messageForCode(result.code);
		} catch (err: unknown) {
			logger.error('App Lock unlock failed:', err);
			error = $t('app_lock.error.failed');
		} finally {
			loading = false;
		}
	}

	// The account password decrypts the key from the server-held wrap - the way
	// out when biometrics are locked out or the vault is empty.
	function usePassword() {
		isRedirecting = true;
		const query = returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
		void goto(`/auth/unlock${query}`);
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

<AuthLayout header={logoHeader}>
	<div class="space-y-6">
		<div class="text-center">
			<div
				class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"
			>
				{#if biometryKind === 'faceId' || biometryKind === 'face'}
					<ScanFace class="h-6 w-6 text-primary" />
				{:else if biometryKind === 'touchId' || biometryKind === 'fingerprint'}
					<Fingerprint class="h-6 w-6 text-primary" />
				{:else}
					<Lock class="h-6 w-6 text-primary" />
				{/if}
			</div>
			<h2 class="text-lg font-semibold text-foreground">{$t('app_lock.locked_title')}</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				{#if biometryKnown && biometryKind === 'none'}
					<!-- No biometry (a phone with only a PIN): the system prompt asks
					     for the device password. -->
					{$t('app_lock.locked_desc_device_credential')}
				{:else}
					{$t('app_lock.locked_desc', { values: { biometry: biometryLabel } })}
				{/if}
			</p>
		</div>

		{#if error}
			<Alert variant="destructive">
				<AlertDescription>{error}</AlertDescription>
			</Alert>
		{/if}

		<div class="space-y-3">
			<Button onclick={runUnlock} disabled={loading} class="w-full">
				{loading ? $t('app_lock.unlocking') : $t('app_lock.unlock_cta')}
			</Button>

			{#if $isAuthenticated}
				<Button variant="ghost" onclick={usePassword} disabled={loading} class="w-full">
					{$t('app_lock.use_password')}
				</Button>
			{/if}
		</div>
	</div>
</AuthLayout>
