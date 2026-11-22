<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { tick } from 'svelte';
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
		AlertDescription
	} from '@reborn/ui';
	import { AlertTriangle, Trash2 } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { base } from '$app/paths';
	import { createLogger } from '@reborn/utils';
	import { logout as authLogout } from '$lib/auth';

	const logger = createLogger('DeleteAccountPage');

	let password = $state('');
	let isLoading = $state(false);
	let submitAttempted = $state(false);
	// Errors sit next to what the user acted on (guideline 02): the password's
	// error under the field, any other failure right above the delete button.
	let passwordRejected = $state(false);
	let submitError = $state<string | null>(null);
	let passwordInput = $state<HTMLElement | null>(null);

	const passwordError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (!password) return $t('auth.validation.required');
		if (passwordRejected) return $t('settings.delete_account.error_invalid_password');
		return null;
	});

	async function handleDelete() {
		submitAttempted = true;
		passwordRejected = false;
		submitError = null;

		if (!password) {
			passwordInput?.focus();
			return;
		}

		isLoading = true;
		try {
			const accessToken = localStorage.getItem('access_token');
			if (!accessToken) {
				submitError = $t('settings.security.session_expired');
				return;
			}

			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/delete-account`, {
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`
				},
				body: JSON.stringify({ password })
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				if (response.status === 400 && data.error === 'Invalid password') {
					passwordRejected = true;
				} else {
					submitError = $t('settings.delete_account.error_generic');
				}
			} else {
				// Clear local data: auth state + IndexedDB + hard redirect
				await authLogout(true);
				try {
					const { clearAllUserData } = await import('@reborn/storage');
					await clearAllUserData();
				} catch {
					// Best-effort - pre-login clear will catch any remnants
				}
				window.location.href = `${base}/auth/login`;
			}
		} catch (err: unknown) {
			logger.error('Failed to delete account:', err);
			submitError = $t('settings.delete_account.error_generic');
		} finally {
			isLoading = false;
		}
		// The field is disabled while the request runs; focus it once it is back.
		if (passwordRejected) {
			await tick();
			passwordInput?.focus();
		}
	}
</script>

<SettingsLayout title={$t('settings.delete_account.page_title')} backHref="/settings">
	<div class="space-y-6">
		<!-- Danger warning -->
		<Alert variant="destructive">
			<AlertTriangle class="h-4 w-4" />
			<AlertDescription class="space-y-1">
				<div class="font-semibold">{$t('settings.delete_account.warning_title')}</div>
				<div>{$t('settings.delete_account.warning_description')}</div>
			</AlertDescription>
		</Alert>

		<Card class="border-destructive/40">
			<CardHeader>
				<CardTitle class="text-base flex items-center gap-2 text-destructive">
					<Trash2 class="h-4 w-4" />
					{$t('settings.delete_account.page_title')}
				</CardTitle>
				<CardDescription>{$t('settings.delete_account.description')}</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleDelete();
					}}
					class="space-y-4"
				>
					<div class="space-y-2">
						<Label for="confirm-password">{$t('settings.delete_account.confirm_label')}</Label>
						<Input
							id="confirm-password"
							type="password"
							bind:value={password}
							bind:ref={passwordInput}
							oninput={() => (passwordRejected = false)}
							placeholder={$t('settings.delete_account.password_placeholder')}
							autocomplete="current-password"
							disabled={isLoading}
							aria-invalid={passwordError ? 'true' : undefined}
							aria-describedby={passwordError ? 'confirm-password-error' : undefined}
							class={passwordError ? 'border-destructive' : ''}
						/>
						{#if passwordError}
							<p id="confirm-password-error" class="text-sm text-destructive">{passwordError}</p>
						{/if}
					</div>

					{#if submitError}
						<Alert variant="destructive">
							<AlertDescription>{submitError}</AlertDescription>
						</Alert>
					{/if}

					<Button type="submit" variant="destructive" disabled={isLoading} class="w-full sm:w-auto">
						{#if isLoading}
							{$t('settings.delete_account.deleting_button')}
						{:else}
							{$t('settings.delete_account.delete_button')}
						{/if}
					</Button>
				</form>
			</CardContent>
		</Card>
	</div>
</SettingsLayout>
