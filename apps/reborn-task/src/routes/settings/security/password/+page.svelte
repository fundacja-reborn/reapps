<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { SettingsLayout, Card, CardContent, CardHeader, CardTitle, CardDescription, Label, Input, Button, Alert, AlertDescription } from '@reborn/ui';
	import { Lock, AlertTriangle } from '@lucide/svelte';
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
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let submitAttempted = $state(false);

	const currentPasswordError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (!currentPassword) return $t('auth.validation.required') || 'Required';
		return null;
	});

	const newPasswordError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (!newPassword) return $t('auth.validation.required') || 'Required';
		if (newPassword.length < 8) return $t('settings.security.password.error_password_too_short');
		if (newPassword === currentPassword) return $t('settings.security.password.error_same_password');
		return null;
	});

	const confirmPasswordError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (!confirmPassword) return $t('auth.validation.required') || 'Required';
		if (confirmPassword !== newPassword) return $t('settings.security.password.error_passwords_mismatch');
		return null;
	});

	const hasErrors = $derived(
		!!(submitAttempted && (currentPasswordError || newPasswordError || confirmPasswordError))
	);

	async function handleSubmit() {
		submitAttempted = true;
		error = null;

		if (hasErrors || !currentPassword || !newPassword || !confirmPassword) return;
		if (newPassword !== confirmPassword) return;
		if (newPassword.length < 8) return;

		isLoading = true;

		try {
			// Re-encrypt master key with new password (client-side)
			const masterKey = cryptoManager.getCurrentKey();
			if (!masterKey) {
				error = 'Encryption key not available. Please reload and try again.';
				return;
			}

			const { encryptedMasterKey: newEncryptedMasterKey, salt: newMasterKeySalt } =
				await cryptoManager.encryptMasterKey(masterKey, newPassword);

			const accessToken = localStorage.getItem('access_token');
			if (!accessToken) {
				error = 'Session expired. Please log in again.';
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
				if (response.status === 400 && data.error === 'Current password is incorrect') {
					error = $t('settings.security.password.error_current_invalid');
				} else {
					error = data.error || 'Failed to change password';
				}
				return;
			}

			// Save new access token (old one was blacklisted server-side)
			if (data.data?.access_token) {
				localStorage.setItem('access_token', data.data.access_token);
			}

			toast.success($t('settings.security.password.success'));

			// Logout and redirect to login (all refresh tokens invalidated)
			await authLogout(true);
			await goto('/auth/login');
		} catch (err: unknown) {
			logger.error('Failed to change password:', err);
			error = 'An unexpected error occurred. Please try again.';
		} finally {
			isLoading = false;
		}
	}
</script>

<SettingsLayout title={$t('settings.security.password.change_title')} backHref="/settings">
	<div class="space-y-6">
		<!-- Warning about other devices -->
		<Alert>
			<AlertTriangle class="h-4 w-4" />
			<AlertDescription>
				{$t('settings.security.password.warning_relogin')}
			</AlertDescription>
		</Alert>

		{#if error}
			<Alert variant="destructive">
				<AlertDescription>{error}</AlertDescription>
			</Alert>
		{/if}

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
						<Input
							id="current-password"
							type="password"
							bind:value={currentPassword}
							autocomplete="current-password"
							disabled={isLoading}
							class={currentPasswordError ? 'border-destructive' : ''}
						/>
						{#if currentPasswordError}
							<p class="text-sm text-destructive">{currentPasswordError}</p>
						{/if}
					</div>

					<!-- New password -->
					<div class="space-y-2">
						<Label for="new-password">{$t('settings.security.password.new_password')}</Label>
						<Input
							id="new-password"
							type="password"
							bind:value={newPassword}
							autocomplete="new-password"
							disabled={isLoading}
							class={newPasswordError ? 'border-destructive' : ''}
						/>
						{#if newPasswordError}
							<p class="text-sm text-destructive">{newPasswordError}</p>
						{/if}
					</div>

					<!-- Confirm new password -->
					<div class="space-y-2">
						<Label for="confirm-password"
							>{$t('settings.security.password.confirm_password')}</Label
						>
						<Input
							id="confirm-password"
							type="password"
							bind:value={confirmPassword}
							autocomplete="new-password"
							disabled={isLoading}
							class={confirmPasswordError ? 'border-destructive' : ''}
						/>
						{#if confirmPasswordError}
							<p class="text-sm text-destructive">{confirmPasswordError}</p>
						{/if}
					</div>

					<Button type="submit" disabled={isLoading} class="w-full sm:w-auto">
						{#if isLoading}
							{$t('common.loading') || 'Updating...'}
						{:else}
							{$t('settings.security.password.update_button')}
						{/if}
					</Button>
				</form>
			</CardContent>
		</Card>
	</div>
</SettingsLayout>
