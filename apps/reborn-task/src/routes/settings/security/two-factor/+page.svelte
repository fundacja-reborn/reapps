<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { onMount } from 'svelte';
	import {
		SettingsLayout,
		Card,
		CardContent,
		CardHeader,
		CardTitle,
		CardDescription,
		Label,
		Input,
		Button,
		Alert,
		AlertDescription,
		Separator
	} from '@reborn/ui';
	import {
		Shield,
		ShieldCheck,
		ShieldOff,
		RefreshCw,
		AlertTriangle,
		Copy,
		Check,
		Download
	} from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { toast } from '@reborn/ui';
	import { createLogger } from '@reborn/utils';
	import QRCode from 'qrcode';

	const logger = createLogger('TwoFactorPage');

	type Step = 'loading' | 'status' | 'setup' | 'recovery-codes' | 'enabled';

	let step = $state<Step>('loading');
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	// Setup state
	let secretBase32 = $state('');
	let qrDataUrl = $state('');

	// Verify state
	let verificationCode = $state('');
	let submitAttempted = $state(false);

	// Disable state
	let disablePassword = $state('');
	let showDisableConfirm = $state(false);
	let isDisabling = $state(false);

	// Status
	let is2FAEnabled = $state(false);

	// Secret copied
	let secretCopied = $state(false);

	// Recovery codes
	let recoveryCodes = $state<string[]>([]);
	let copiedIndex = $state<number | null>(null);

	function getAccessToken(): string | null {
		return localStorage.getItem('access_token');
	}

	async function fetchStatus() {
		try {
			const accessToken = getAccessToken();
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/2fa`, {
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			const data = await response.json();

			if (data.success) {
				is2FAEnabled = data.data.isEnabled;
				step = is2FAEnabled ? 'enabled' : 'status';
			} else {
				error = data.error || 'Failed to load 2FA status';
				step = 'status';
			}
		} catch (err: unknown) {
			logger.error('Failed to fetch 2FA status:', err);
			error = 'Failed to load 2FA status';
			step = 'status';
		}
	}

	async function startSetup() {
		isLoading = true;
		error = null;

		try {
			const accessToken = getAccessToken();
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/2fa`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			const data = await response.json();

			if (data.success) {
				const otpauthUri = data.data.otpauthUri;
				secretBase32 = data.data.secret;

				// Generate QR code
				qrDataUrl = await QRCode.toDataURL(otpauthUri, {
					width: 256,
					margin: 2,
					color: { dark: '#000000', light: '#ffffff' }
				});

				step = 'setup';
			} else {
				error = data.error || 'Failed to start 2FA setup';
			}
		} catch (err: unknown) {
			logger.error('Failed to start 2FA setup:', err);
			error = 'Failed to start 2FA setup';
		} finally {
			isLoading = false;
		}
	}

	async function verifyAndEnable() {
		submitAttempted = true;
		error = null;

		if (!verificationCode || verificationCode.length !== 6) return;

		isLoading = true;

		try {
			const accessToken = getAccessToken();
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/2fa`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`
				},
				body: JSON.stringify({
					code: verificationCode,
					secretEncrypted: ''
				})
			});
			const data = await response.json();

			if (data.success) {
				toast.success($t('settings.profile.two_factor_auth_enabled'));
				is2FAEnabled = true;
				verificationCode = '';
				submitAttempted = false;
				secretBase32 = '';
				qrDataUrl = '';

				// Auto-generate recovery codes
				try {
					const codesResponse = await fetch(`${PUBLIC_BASE_PATH}/api/auth/recovery-codes`, {
						method: 'POST',
						headers: { Authorization: `Bearer ${accessToken}` }
					});
					const codesData = await codesResponse.json();
					if (codesData.success && codesData.data.codes?.length) {
						recoveryCodes = codesData.data.codes;
						step = 'recovery-codes';
					} else {
						logger.warn('Recovery codes generation failed, skipping to enabled');
						toast.warning($t('settings.security.backup_codes.generate_failed_warning'));
						step = 'enabled';
					}
				} catch (codesErr) {
					logger.warn('Recovery codes generation error:', codesErr);
					toast.warning($t('settings.security.backup_codes.generate_failed_warning'));
					step = 'enabled';
				}
			} else {
				error =
					data.error === 'Invalid verification code'
						? $t('settings.profile.verification_code_invalid') || 'Invalid verification code'
						: data.error || 'Verification failed';
			}
		} catch (err: unknown) {
			logger.error('Failed to verify 2FA:', err);
			error = 'Verification failed';
		} finally {
			isLoading = false;
		}
	}

	async function disable2FA() {
		if (!disablePassword) {
			error = $t('auth.validation.required') || 'Password is required';
			return;
		}

		isDisabling = true;
		error = null;

		try {
			const accessToken = getAccessToken();
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/2fa`, {
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`
				},
				body: JSON.stringify({ password: disablePassword })
			});
			const data = await response.json();

			if (data.success) {
				toast.success($t('settings.profile.two_factor_auth_disabled'));
				is2FAEnabled = false;
				step = 'status';
				showDisableConfirm = false;
				disablePassword = '';
			} else {
				error =
					data.error === 'Invalid password'
						? $t('settings.security.password.error_current_invalid') || 'Invalid password'
						: data.error || 'Failed to disable 2FA';
			}
		} catch (err: unknown) {
			logger.error('Failed to disable 2FA:', err);
			error = 'Failed to disable 2FA';
		} finally {
			isDisabling = false;
		}
	}

	function downloadCodes() {
		if (!recoveryCodes.length) return;
		const content = [
			're/task — Backup Codes',
			`Generated: ${new Date().toLocaleString()}`,
			'',
			'Keep these codes in a safe place. Each code can only be used once.',
			'',
			...recoveryCodes.map((code, i) => `${i + 1}. ${code}`)
		].join('\n');

		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'reborn-backup-codes.txt';
		a.click();
		URL.revokeObjectURL(url);
	}

	async function copyCode(code: string, index: number) {
		try {
			await navigator.clipboard.writeText(code);
			copiedIndex = index;
			setTimeout(() => (copiedIndex = null), 2000);
		} catch {
			// Clipboard not available
		}
	}

	async function copyAllCodes() {
		if (!recoveryCodes.length) return;
		try {
			await navigator.clipboard.writeText(recoveryCodes.join('\n'));
			toast.success($t('settings.security.backup_codes.copied'));
		} catch {
			// Clipboard not available
		}
	}

	async function copySecret() {
		try {
			await navigator.clipboard.writeText(secretBase32);
			secretCopied = true;
			setTimeout(() => (secretCopied = false), 2000);
		} catch {
			// Clipboard not available
		}
	}

	const codeError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (!verificationCode)
			return $t('settings.profile.verification_code_required') || 'Code is required';
		if (verificationCode.length !== 6)
			return $t('settings.profile.verification_code_invalid') || 'Code must be 6 digits';
		return null;
	});

	onMount(() => {
		fetchStatus();
	});
</script>

<SettingsLayout title={$t('settings.security.two_factor.title')} backHref="/settings">
	<div class="space-y-6">
		{#if error}
			<Alert variant="destructive">
				<AlertDescription>{error}</AlertDescription>
			</Alert>
		{/if}

		{#if step === 'loading'}
			<Card>
				<CardContent class="pt-6">
					<div class="flex items-center justify-center py-8">
						<RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		{:else if step === 'status'}
			<!-- 2FA is not enabled -->
			<Alert>
				<Shield class="h-4 w-4" />
				<AlertDescription>
					{$t('settings.profile.two_factor_auth_description')}
				</AlertDescription>
			</Alert>

			<Card>
				<CardHeader>
					<CardTitle class="text-base flex items-center gap-2">
						<ShieldOff class="h-4 w-4 text-muted-foreground" />
						{$t('settings.profile.two_factor_auth_disabled_status')}
					</CardTitle>
					<CardDescription>
						{$t('settings.profile.two_factor_auth_disabled_description')}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button onclick={startSetup} disabled={isLoading} class="w-full sm:w-auto">
						{#if isLoading}
							<RefreshCw class="h-4 w-4 mr-2 animate-spin" />
							{$t('common.loading') || 'Loading...'}
						{:else}
							<Shield class="h-4 w-4 mr-2" />
							{$t('settings.profile.two_factor_auth_enable')}
						{/if}
					</Button>
				</CardContent>
			</Card>
		{:else if step === 'setup'}
			<!-- Setup: QR code + manual secret -->
			<Alert>
				<AlertTriangle class="h-4 w-4" />
				<AlertDescription>
					<strong>{$t('settings.profile.2fa_do_not_refresh')}</strong>
					{$t('settings.profile.2fa_do_not_refresh_desc')}
				</AlertDescription>
			</Alert>

			<Card>
				<CardHeader>
					<CardTitle class="text-base">
						{$t('settings.profile.two_factor_auth_setup')}
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-6">
					<!-- Step 1 -->
					<div class="space-y-2">
						<p class="text-sm font-medium">
							1. {$t('settings.profile.two_factor_auth_step1')}
						</p>
					</div>

					<!-- Step 2: QR Code -->
					<div class="space-y-3">
						<p class="text-sm font-medium">
							2. {$t('settings.profile.two_factor_auth_step2')}
						</p>
						<div class="flex justify-center">
							{#if qrDataUrl}
								<div class="rounded-lg border bg-white p-3">
									<img src={qrDataUrl} alt="TOTP QR Code" class="h-48 w-48 sm:h-56 sm:w-56" />
								</div>
							{/if}
						</div>

						<!-- Manual secret -->
						<div class="space-y-2">
							<p class="text-xs text-muted-foreground text-center">
								{$t('settings.profile.two_factor_auth_manual_entry', {
									default: 'Lub wpisz ten kod ręcznie:'
								})}
							</p>
							<div class="flex items-center justify-center gap-2">
								<code
									class="bg-muted px-3 py-1.5 rounded text-sm font-mono tracking-wider select-all"
								>
									{secretBase32}
								</code>
								<button
									onclick={copySecret}
									class="text-muted-foreground hover:text-foreground transition-colors p-1"
									aria-label="Copy secret"
								>
									{#if secretCopied}
										<Check class="h-4 w-4 text-green-500" />
									{:else}
										<Copy class="h-4 w-4" />
									{/if}
								</button>
							</div>
						</div>
					</div>

					<Separator />

					<!-- Step 3: Verification -->
					<div class="space-y-3">
						<p class="text-sm font-medium">
							3. {$t('settings.profile.two_factor_auth_step3')}
						</p>
						<form
							onsubmit={(e) => {
								e.preventDefault();
								verifyAndEnable();
							}}
							class="space-y-4"
						>
							<div class="space-y-2">
								<Label for="verification-code">{$t('settings.profile.verification_code')}</Label>
								<Input
									id="verification-code"
									type="text"
									inputmode="numeric"
									autocomplete="one-time-code"
									maxlength={6}
									pattern="[0-9]*"
									placeholder="000000"
									bind:value={verificationCode}
									disabled={isLoading}
									class={codeError
										? 'border-destructive font-mono text-center text-lg tracking-widest'
										: 'font-mono text-center text-lg tracking-widest'}
								/>
								{#if codeError}
									<p class="text-sm text-destructive">{codeError}</p>
								{/if}
							</div>

							<div class="flex gap-2 flex-wrap">
								<Button type="submit" disabled={isLoading}>
									{#if isLoading}
										<RefreshCw class="h-4 w-4 mr-2 animate-spin" />
										{$t('common.loading') || 'Verifying...'}
									{:else}
										{$t('settings.profile.verify_and_enable')}
									{/if}
								</Button>
								<Button
									type="button"
									variant="outline"
									onclick={() => {
										step = 'status';
										error = null;
										verificationCode = '';
										submitAttempted = false;
									}}
									disabled={isLoading}
								>
									{$t('common.cancel') || 'Cancel'}
								</Button>
							</div>
						</form>
					</div>
				</CardContent>
			</Card>
		{:else if step === 'recovery-codes'}
			<!-- Recovery codes after 2FA setup -->
			<Alert>
				<AlertTriangle class="h-4 w-4" />
				<AlertDescription>
					{$t('settings.security.backup_codes.one_time_warning')}
				</AlertDescription>
			</Alert>

			<Card class="border-primary/50">
				<CardHeader>
					<CardTitle class="text-base flex items-center gap-2">
						<ShieldCheck class="h-4 w-4 text-green-600 dark:text-green-400" />
						{$t('settings.security.backup_codes.setup_title')}
					</CardTitle>
					<CardDescription>
						{$t('settings.security.backup_codes.setup_description')}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<!-- Code grid -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{#each recoveryCodes as code, i}
							<div
								class="flex items-center justify-between font-mono text-sm bg-muted px-3 py-2 rounded border"
							>
								<span class="tracking-widest">{code}</span>
								<button
									onclick={() => copyCode(code, i)}
									class="ml-2 text-muted-foreground hover:text-foreground transition-colors"
									aria-label="Copy code"
								>
									{#if copiedIndex === i}
										<Check class="h-4 w-4 text-green-500" />
									{:else}
										<Copy class="h-4 w-4" />
									{/if}
								</button>
							</div>
						{/each}
					</div>

					<Separator />

					<div class="flex gap-2 flex-wrap">
						<Button onclick={downloadCodes} variant="outline">
							<Download class="h-4 w-4 mr-2" />
							{$t('settings.security.backup_codes.download_button')}
						</Button>
						<Button onclick={copyAllCodes} variant="outline">
							<Copy class="h-4 w-4 mr-2" />
							{$t('settings.security.backup_codes.copy_all')}
						</Button>
					</div>

					<Separator />

					<Button
						onclick={() => {
							recoveryCodes = [];
							step = 'enabled';
						}}
						class="w-full"
					>
						{$t('settings.security.backup_codes.saved_continue')}
					</Button>
				</CardContent>
			</Card>
		{:else if step === 'enabled'}
			<!-- 2FA is enabled -->
			<Card>
				<CardHeader>
					<CardTitle class="text-base flex items-center gap-2">
						<ShieldCheck class="h-4 w-4 text-green-600 dark:text-green-400" />
						{$t('settings.profile.two_factor_auth_enabled_status')}
					</CardTitle>
					<CardDescription>
						{$t('settings.profile.two_factor_auth_enabled_description')}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if !showDisableConfirm}
						<Button
							variant="destructive"
							onclick={() => (showDisableConfirm = true)}
							class="w-full sm:w-auto"
						>
							<ShieldOff class="h-4 w-4 mr-2" />
							{$t('settings.profile.two_factor_auth_disable')}
						</Button>
					{:else}
						<Alert variant="destructive">
							<AlertTriangle class="h-4 w-4" />
							<AlertDescription>
								{$t('settings.profile.two_factor_auth_disable_confirm')}
							</AlertDescription>
						</Alert>

						<form
							onsubmit={(e) => {
								e.preventDefault();
								disable2FA();
							}}
							class="space-y-4"
						>
							<div class="space-y-2">
								<Label for="disable-password">{$t('settings.profile.password')}</Label>
								<Input
									id="disable-password"
									type="password"
									autocomplete="current-password"
									bind:value={disablePassword}
									disabled={isDisabling}
								/>
							</div>

							<div class="flex gap-2 flex-wrap">
								<Button type="submit" variant="destructive" disabled={isDisabling}>
									{#if isDisabling}
										<RefreshCw class="h-4 w-4 mr-2 animate-spin" />
										{$t('common.loading') || 'Disabling...'}
									{:else}
										{$t('settings.profile.disable_2fa')}
									{/if}
								</Button>
								<Button
									type="button"
									variant="outline"
									onclick={() => {
										showDisableConfirm = false;
										disablePassword = '';
										error = null;
									}}
									disabled={isDisabling}
								>
									{$t('common.cancel') || 'Cancel'}
								</Button>
							</div>
						</form>
					{/if}
				</CardContent>
			</Card>
		{/if}
	</div>
</SettingsLayout>
