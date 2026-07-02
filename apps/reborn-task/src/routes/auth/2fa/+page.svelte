<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { goto } from '$lib/utils/navigation';
	import { page } from '$app/stores';
	import { t } from '$lib/stores/i18n.store';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { syncService } from '$lib/services/sync.service';
	import { createLogger } from '@reborn/utils';
	import {
		Card,
		CardContent,
		CardHeader,
		CardTitle,
		CardDescription,
		Label,
		Input,
		Button,
		Alert,
		AlertDescription
	} from '@reborn/ui';
	import { Shield, RefreshCw, KeyRound } from '@lucide/svelte';
	import { untrack } from 'svelte';

	const logger = createLogger('2FAVerifyPage');

	let challengeToken = $state('');
	let returnTo = $state('/all');
	let encryptedMasterKey = $state('');
	let masterKeySalt = $state('');

	let code = $state('');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let showRecoveryInput = $state(false);
	let recoveryCode = $state('');

	$effect(() => {
		if (browser) {
			const url = new URL($page.url);
			// The challenge token (proof of the password step, audit 012 S4) is a
			// credential - it travels via sessionStorage, not the URL.
			challengeToken = sessionStorage.getItem('2fa_challenge_token') || '';
			returnTo = url.searchParams.get('returnTo') || '/all';
			encryptedMasterKey = url.searchParams.get('emk') || '';
			masterKeySalt = url.searchParams.get('ms') || '';

			if (!challengeToken) {
				untrack(() => goto('/auth/login'));
			}
		}
	});

	async function handleVerify() {
		const codeToVerify = showRecoveryInput ? recoveryCode.trim() : code.trim();
		error = null;

		if (!codeToVerify) {
			error = $t('settings.profile.verification_code_required') || 'Verification code is required';
			return;
		}

		if (!showRecoveryInput && codeToVerify.length !== 6) {
			error = $t('settings.profile.verification_code_invalid') || 'Code must be 6 digits';
			return;
		}

		isLoading = true;

		try {
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/2fa/verify`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ challengeToken, code: codeToVerify })
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				if (response.status === 401) {
					// Challenge token expired (5-min TTL) or already used - the user
					// must restart from the password step. The back-to-login link is
					// right below the form.
					sessionStorage.removeItem('2fa_challenge_token');
					error = $t('auth.2fa.errors.challenge_expired');
				} else {
					error =
						data.error === 'Invalid verification code'
							? $t('settings.profile.verification_code_invalid') || 'Invalid verification code'
							: data.error || '2FA verification failed';
				}
				isLoading = false;
				return;
			}

			sessionStorage.removeItem('2fa_challenge_token');

			// Store access token (refresh token is managed via httpOnly cookie)
			if (data.data.access_token) {
				localStorage.setItem('access_token', data.data.access_token);
			}

			// Set token in sync service
			if (data.data.access_token) {
				syncService.setAuthToken(data.data.access_token);
			}

			logger.info('2FA verification successful, completing login...');

			// Now complete the login flow via AuthService
			// We need to call completeLogin which decrypts master key and initializes E2E
			const { getAuthService } = await import('$lib/auth');
			const authService = getAuthService();

			const loginResult = {
				success: true as const,
				user: data.data.user,
				accessToken: data.data.access_token,
				// refresh_token is managed exclusively via httpOnly cookie (set by server)
				encryptedMasterKey: data.data.encryptedMasterKey || encryptedMasterKey,
				masterKeySalt: data.data.masterKeySalt || masterKeySalt
			};

			// We need the password to complete login (decrypt master key)
			// The password was entered on the login page, so we need to pass it via sessionStorage
			const savedPassword = sessionStorage.getItem('2fa_pending_password');
			if (savedPassword) {
				sessionStorage.removeItem('2fa_pending_password');
				await authService.completeLogin(loginResult, savedPassword);
			} else {
				// Fallback: redirect to unlock page to enter password for E2E
				logger.warn('No saved password for 2FA completion, redirecting to unlock');
			}

			// Wait for state to settle
			await new Promise((resolve) => setTimeout(resolve, 100));

			logger.info('Redirecting to:', returnTo);
			await goto(returnTo);
		} catch (err: unknown) {
			logger.error('2FA verification error:', err);
			error = err instanceof Error ? err.message : 'An error occurred. Please try again.';
			isLoading = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center px-4 py-12">
	<div class="w-full max-w-md space-y-6">
		<!-- Header -->
		<div class="text-center space-y-2">
			<div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
				<Shield class="h-7 w-7 text-primary" />
			</div>
			<h1 class="text-2xl font-bold tracking-tight">
				{$t('settings.profile.two_factor_auth', { default: 'Weryfikacja dwuetapowa' })}
			</h1>
			<p class="text-sm text-muted-foreground">
				{$t('settings.profile.two_factor_auth_step3', {
					default: 'Wprowadź kod weryfikacyjny z aplikacji uwierzytelniającej'
				})}
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
							<Label for="totp-code"
								>{$t('settings.profile.verification_code', {
									default: 'Kod weryfikacyjny'
								})}</Label
							>
							<Input
								id="totp-code"
								type="text"
								inputmode="numeric"
								autocomplete="one-time-code"
								oninput={(e) => { const next = e.currentTarget.value.replace(/\D/g, '').slice(0, 6); if (e.currentTarget.value !== next) e.currentTarget.value = next; code = next; }}
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
								{$t('common.loading') || 'Weryfikowanie...'}
							{:else}
								{$t('settings.profile.verify_and_enable', { default: 'Zweryfikuj' })}
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
							{$t('settings.profile.recovery_codes', { default: 'Użyj kodu zapasowego' })}
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
							<Label for="recovery-code"
								>{$t('settings.profile.recovery_codes', {
									default: 'Kod zapasowy'
								})}</Label
							>
							<Input
								id="recovery-code"
								type="text"
								placeholder="XXXXX-XXXXX"
								bind:value={recoveryCode}
								disabled={isLoading}
								class="font-mono text-center text-lg tracking-wider h-12"
							/>
							<p class="text-xs text-muted-foreground">
								{$t('settings.profile.recovery_codes_description', {
									default:
										'Wprowadź jeden z kodów odzyskiwania wygenerowanych w ustawieniach bezpieczeństwa'
								})}
							</p>
						</div>

						<Button type="submit" disabled={isLoading} class="w-full h-11">
							{#if isLoading}
								<RefreshCw class="h-4 w-4 mr-2 animate-spin" />
								{$t('common.loading') || 'Weryfikowanie...'}
							{:else}
								{$t('settings.profile.verify_and_enable', { default: 'Zweryfikuj' })}
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
							{$t('settings.profile.two_factor_auth_step3', {
								default: 'Użyj kodu z aplikacji'
							})}
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
				{$t('auth.back_to_login', { default: 'Wróć do logowania' })}
			</a>
		</div>
	</div>
</div>
