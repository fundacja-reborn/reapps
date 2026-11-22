<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { tick } from 'svelte';
	import { SettingsLayout, Card, CardContent, CardHeader, CardTitle, CardDescription, Label, Input, Button, Alert, AlertDescription } from '@reborn/ui';
	import { Lock, AlertTriangle, Eye, EyeOff } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { toast } from '@reborn/ui';
	import { cryptoManager } from '@reborn/crypto';
	import { createLogger } from '@reborn/utils';
	import { logout as authLogout } from '$lib/auth';

	const logger = createLogger('PasswordSettingsPage');

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	// One eye button per field, all showing / hiding the three together.
	let showPassword = $state(false);
	let isLoading = $state(false);
	let submitAttempted = $state(false);
	// Errors sit next to what the user acted on (guideline 02): a field's error
	// under the field, any other failure right above the submit button.
	let currentRejected = $state(false);
	let submitError = $state<string | null>(null);
	let currentPasswordInput = $state<HTMLElement | null>(null);
	let newPasswordInput = $state<HTMLElement | null>(null);
	let confirmPasswordInput = $state<HTMLElement | null>(null);

	const currentPasswordError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (!currentPassword) return $t('auth.validation.required');
		if (currentRejected) return $t('settings.security.password.error_current_invalid');
		return null;
	});

	const newPasswordError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (!newPassword) return $t('auth.validation.required');
		if (newPassword.length < 8) return $t('settings.security.password.error_password_too_short');
		if (newPassword === currentPassword) return $t('settings.security.password.error_same_password');
		return null;
	});

	const confirmPasswordError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (!confirmPassword) return $t('auth.validation.required');
		if (confirmPassword !== newPassword) return $t('settings.security.password.error_passwords_mismatch');
		return null;
	});

	const hasErrors = $derived(
		!!(submitAttempted && (currentPasswordError || newPasswordError || confirmPasswordError))
	);

	function focusFirstInvalid() {
		if (currentPasswordError) currentPasswordInput?.focus();
		else if (newPasswordError) newPasswordInput?.focus();
		else if (confirmPasswordError) confirmPasswordInput?.focus();
	}

	async function handleSubmit() {
		submitAttempted = true;
		currentRejected = false;
		submitError = null;

		if (hasErrors || !currentPassword || !newPassword || !confirmPassword) {
			focusFirstInvalid();
			return;
		}
		if (newPassword !== confirmPassword) return;
		if (newPassword.length < 8) return;

		isLoading = true;

		try {
			// Re-encrypt master key with new password (client-side)
			const masterKey = cryptoManager.getCurrentKey();
			if (!masterKey) {
				submitError = $t('settings.security.password.error_key_unavailable');
				return;
			}

			const { encryptedMasterKey: newEncryptedMasterKey, salt: newMasterKeySalt } =
				await cryptoManager.encryptMasterKey(masterKey, newPassword);

			const accessToken = localStorage.getItem('access_token');
			if (!accessToken) {
				submitError = $t('settings.security.session_expired');
				return;
			}

			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/change-password`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`
				},
				body: JSON.stringify({
					currentPassword,
					newPassword,
					newEncryptedMasterKey,
					newMasterKeySalt
				})
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				// The server's `error` is English text for logs, never shown as is.
				if (response.status === 400 && data.error === 'Current password is incorrect') {
					currentRejected = true;
				} else {
					submitError = $t('settings.security.password.error_failed');
				}
			} else {
				// Save new access token (old one was blacklisted server-side)
				if (data.data?.access_token) {
					localStorage.setItem('access_token', data.data.access_token);
				}

				toast.success($t('settings.security.password.success'));

				// Logout and redirect to login (all refresh tokens invalidated)
				await authLogout(true);
				await goto('/auth/login');
			}
		} catch (err: unknown) {
			logger.error('Failed to change password:', err);
			submitError = $t('settings.security.password.error_unexpected');
		} finally {
			isLoading = false;
		}
		// The fields are disabled while the request runs; focus once they are back.
		if (currentRejected) {
			await tick();
			currentPasswordInput?.focus();
		}
	}
</script>

{#snippet revealToggle()}
	<button
		type="button"
		class="absolute inset-y-0 inset-e-0 flex items-center pe-3 text-muted-foreground hover:text-foreground"
		onclick={() => (showPassword = !showPassword)}
		aria-label={showPassword ? $t('auth.unlock.hide_password') : $t('auth.unlock.show_password')}
		aria-pressed={showPassword}
	>
		{#if showPassword}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
	</button>
{/snippet}

<SettingsLayout title={$t('settings.security.password.change_title')} backHref="/settings">
	<div class="space-y-6">
		<!-- Warning about other devices -->
		<Alert>
			<AlertTriangle class="h-4 w-4" />
			<AlertDescription>
				{$t('settings.security.password.warning_relogin')}
			</AlertDescription>
		</Alert>

		<Card>
			<CardHeader>
				<CardTitle class="text-base flex items-center gap-2">
					<Lock class="h-4 w-4 text-muted-foreground" />
					{$t('settings.security.password.change_title')}
				</CardTitle>
				<CardDescription>{$t('settings.security.password.description')}</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					class="space-y-4"
				>
					<!-- Current password -->
					<div class="space-y-2">
						<Label for="current-password">{$t('settings.security.password.current_password')}</Label>
						<div class="relative">
							<Input
								id="current-password"
								type={showPassword ? 'text' : 'password'}
								bind:value={currentPassword}
								bind:ref={currentPasswordInput}
								oninput={() => (currentRejected = false)}
								autocomplete="current-password"
								disabled={isLoading}
								aria-invalid={currentPasswordError ? 'true' : undefined}
								aria-describedby={currentPasswordError ? 'current-password-error' : undefined}
								class="pe-10 {currentPasswordError ? 'border-destructive' : ''}"
							/>
							{@render revealToggle()}
						</div>
						{#if currentPasswordError}
							<p id="current-password-error" class="text-sm text-destructive">
								{currentPasswordError}
							</p>
						{/if}
					</div>

					<!-- New password -->
					<div class="space-y-2">
						<Label for="new-password">{$t('settings.security.password.new_password')}</Label>
						<div class="relative">
							<Input
								id="new-password"
								type={showPassword ? 'text' : 'password'}
								bind:value={newPassword}
								bind:ref={newPasswordInput}
								autocomplete="new-password"
								disabled={isLoading}
								aria-invalid={newPasswordError ? 'true' : undefined}
								aria-describedby={newPasswordError ? 'new-password-error' : undefined}
								class="pe-10 {newPasswordError ? 'border-destructive' : ''}"
							/>
							{@render revealToggle()}
						</div>
						{#if newPasswordError}
							<p id="new-password-error" class="text-sm text-destructive">{newPasswordError}</p>
						{/if}
					</div>

					<!-- Confirm new password -->
					<div class="space-y-2">
						<Label for="confirm-password"
							>{$t('settings.security.password.confirm_password')}</Label
						>
						<div class="relative">
							<Input
								id="confirm-password"
								type={showPassword ? 'text' : 'password'}
								bind:value={confirmPassword}
								bind:ref={confirmPasswordInput}
								autocomplete="new-password"
								disabled={isLoading}
								aria-invalid={confirmPasswordError ? 'true' : undefined}
								aria-describedby={confirmPasswordError ? 'confirm-password-error' : undefined}
								class="pe-10 {confirmPasswordError ? 'border-destructive' : ''}"
							/>
							{@render revealToggle()}
						</div>
						{#if confirmPasswordError}
							<p id="confirm-password-error" class="text-sm text-destructive">
								{confirmPasswordError}
							</p>
						{/if}
					</div>

					{#if submitError}
						<Alert variant="destructive">
							<AlertDescription>{submitError}</AlertDescription>
						</Alert>
					{/if}

					<Button type="submit" disabled={isLoading} class="w-full sm:w-auto">
						{#if isLoading}
							{$t('common.loading')}
						{:else}
							{$t('settings.security.password.update_button')}
						{/if}
					</Button>
				</form>
			</CardContent>
		</Card>
	</div>
</SettingsLayout>
