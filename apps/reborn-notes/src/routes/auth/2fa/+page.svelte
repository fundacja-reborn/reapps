<script lang="ts">
	import { API_BASE } from '$lib/utils/api-base';
	import { nativeAuthHeaders } from '$lib/utils/native-client';
	import { persistNativeRefreshToken } from '$lib/utils/native-auth-storage';
	import { persistNativeSessionId } from '$lib/utils/native-session';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { goto } from '$lib/utils/navigation';
	import { page } from '$app/stores';
	import { t } from '$lib/stores/i18n.store';
	import { authStore, CREDENTIALS_KEY, ACCESS_TOKEN_KEY } from '$lib/stores/auth.store';
	import {
		Card,
		CardContent,
		Label,
		Input,
		Button,
		Alert,
		AlertDescription
	} from '@reborn/ui';
	import { Shield, RefreshCw, KeyRound } from '@lucide/svelte';
	import { untrack } from 'svelte';

	let userId = $state('');
	let encryptedMasterKey = $state('');
	let masterKeySalt = $state('');
	let returnTo = $state('/');

	let code = $state('');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let showRecoveryInput = $state(false);
	let recoveryCode = $state('');

	$effect(() => {
		if (browser) {
			const url = new URL($page.url);
			userId = url.searchParams.get('userId') ?? '';
			encryptedMasterKey = url.searchParams.get('emk') ?? '';
			masterKeySalt = url.searchParams.get('ms') ?? '';
			returnTo = url.searchParams.get('returnTo') ?? '/';

			if (!userId) {
				untrack(() => goto('/auth/login'));
			}
		}
	});

	async function handleVerify() {
		const codeToVerify = showRecoveryInput ? recoveryCode.trim() : code.trim();
		error = null;

		if (!codeToVerify) {
			error = $t('auth.two_factor.code_required');
			return;
		}

		if (!showRecoveryInput && codeToVerify.length !== 6) {
			error = $t('auth.two_factor.code_6_digits');
			return;
		}

		isLoading = true;

		try {
			const res = await fetch(`${API_BASE}/auth/2fa/verify`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...nativeAuthHeaders() },
				body: JSON.stringify({ userId, code: codeToVerify })
			});
			const body = await res.json();

			if (!res.ok || !body.success) {
				error =
					body.error === 'Invalid verification code'
						? $t('auth.two_factor.invalid_code')
						: (body.error ?? $t('auth.two_factor.failed'));
				isLoading = false;
				return;
			}

			const { data } = body;

			// Save credentials to localStorage (same format as reborn-task — SSO-compatible)
			const credentials = {
				id: data.user.id,
				// refresh_token is managed exclusively via httpOnly cookie (set by server)
				encrypted_master_key: data.encryptedMasterKey ?? encryptedMasterKey,
				master_key_salt: data.masterKeySalt ?? masterKeySalt,
				user_profile: data.user
			};
			localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
			localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
			// Web: refresh_token is managed exclusively via httpOnly cookie (set by server).
			// Native: persist the body refresh token to secure storage. No-op on web.
			await persistNativeRefreshToken(data.refresh_token);
			// Native: 2FA users get their session created here (not at /login), so the
			// session_id arrives in this response - stash it for device-info + list highlight.
			persistNativeSessionId(data.session_id);

			// Unlock E2E — use password saved by login page before redirect
			const savedPassword = sessionStorage.getItem('2fa_pending_password');
			if (savedPassword) {
				sessionStorage.removeItem('2fa_pending_password');
				await authStore.unlockE2E(savedPassword);
			} else {
				// No saved password — hydrate auth state and let unlock page handle E2E
				authStore.initialize();
			}

			await goto(returnTo);
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : 'An error occurred. Please try again.';
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{$t('auth.two_factor.title')} - re/notes</title>
</svelte:head>

<!-- height/min-height subtract --rn-keyboard-inset (set on :root by the layout's
     visual-viewport tracker) so the soft keyboard does not cover the focused
     code field on iOS native - matches AuthLayout (this page predates it). -->
<div class="h-[calc(100dvh-var(--rn-keyboard-inset,0px))] overflow-y-auto">
<div class="flex min-h-[calc(100dvh-var(--rn-keyboard-inset,0px))] items-center justify-center px-4 py-12">
	<div class="w-full max-w-md space-y-6">
		<!-- Header -->
		<div class="text-center space-y-2">
			<div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
				<Shield class="h-7 w-7 text-primary" />
			</div>
			<h1 class="text-2xl font-bold tracking-tight">
				{$t('auth.two_factor.title')}
			</h1>
			<p class="text-sm text-muted-foreground">
				{$t('auth.two_factor.totp_desc')}
			</p>
		</div>

		{#if error}
			<Alert variant="destructive">
				<AlertDescription>{error}</AlertDescription>
			</Alert>
		{/if}

		<Card>
			<CardContent class="pt-6">
				{#if !showRecoveryInput}
					<!-- TOTP code input -->
					<form
						onsubmit={(e) => {
							e.preventDefault();
							handleVerify();
						}}
						class="space-y-4"
					>
						<div class="space-y-2">
							<Label for="totp-code">{$t('auth.two_factor.code_label')}</Label>
							<Input
								id="totp-code"
								type="text"
								inputmode="numeric"
								autocomplete="one-time-code"
								maxlength={6}
								pattern="[0-9]*"
								placeholder="000000"
								bind:value={code}
								disabled={isLoading}
								class="font-mono text-center text-2xl tracking-[0.5em] h-14"
							/>
						</div>

						<Button type="submit" disabled={isLoading} class="w-full h-11">
							{#if isLoading}
								<RefreshCw class="h-4 w-4 mr-2 animate-spin" />
								{$t('auth.two_factor.verifying')}
							{:else}
								{$t('auth.two_factor.verify')}
							{/if}
						</Button>
					</form>

					<div class="mt-4 text-center">
						<button
							onclick={() => {
								showRecoveryInput = true;
								error = null;
							}}
							class="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
						>
							<KeyRound class="h-3.5 w-3.5 inline mr-1" />
							{$t('auth.two_factor.use_recovery')}
						</button>
					</div>
				{:else}
					<!-- Recovery code input -->
					<form
						onsubmit={(e) => {
							e.preventDefault();
							handleVerify();
						}}
						class="space-y-4"
					>
						<div class="space-y-2">
							<Label for="recovery-code">{$t('auth.two_factor.recovery_label')}</Label>
							<Input
								id="recovery-code"
								type="text"
								placeholder="XXXXX-XXXXX"
								bind:value={recoveryCode}
								disabled={isLoading}
								class="font-mono text-center text-lg tracking-wider h-12"
							/>
							<p class="text-xs text-muted-foreground">
								{$t('auth.two_factor.recovery_note')}
							</p>
						</div>

						<Button type="submit" disabled={isLoading} class="w-full h-11">
							{#if isLoading}
								<RefreshCw class="h-4 w-4 mr-2 animate-spin" />
								{$t('auth.two_factor.verifying')}
							{:else}
								{$t('auth.two_factor.verify')}
							{/if}
						</Button>
					</form>

					<div class="mt-4 text-center">
						<button
							onclick={() => {
								showRecoveryInput = false;
								error = null;
							}}
							class="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
						>
							<Shield class="h-3.5 w-3.5 inline mr-1" />
							{$t('auth.two_factor.use_app')}
						</button>
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Back to login -->
		<div class="text-center">
			<a
				href={resolve('/auth/login')}
				class="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
			>
				{$t('auth.two_factor.back_to_login')}
			</a>
		</div>
	</div>
</div>
</div>
