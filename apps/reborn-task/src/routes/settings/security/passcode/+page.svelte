<script lang="ts">
	import { onMount, tick } from 'svelte';
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
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle,
		toast
	} from '@reborn/ui';
	import { Lock, LockKeyhole, Eye, EyeOff } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { isLocalOnly } from '$lib/stores/auth.store';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import {
		cryptoManager,
		LOCAL_PASSCODE_MIN_LENGTH,
		isTriviallyGuessablePasscode
	} from '@reborn/crypto';
	import { createLogger } from '@reborn/utils';
	import { get } from 'svelte/store';

	const logger = createLogger('PasscodeSettingsPage');
	// Enforced by the crypto layer (enable/change throw below it) - the UI just
	// mirrors the shared constant for validation copy (audit 012 N6).
	const MIN_LENGTH = LOCAL_PASSCODE_MIN_LENGTH;

	let enabled = $state(false);

	// Setup / change form state.
	let currentPasscode = $state('');
	let newPasscode = $state('');
	let confirmPasscode = $state('');
	let showPasscode = $state(false);
	let submitAttempted = $state(false);
	let isSaving = $state(false);
	// Errors sit next to what the user acted on (guideline 02): a wrong current
	// passcode under its field, a failed save right above the save button.
	let currentRejected = $state(false);
	let saveError = $state<string | null>(null);
	let currentInput = $state<HTMLElement | null>(null);
	let newInput = $state<HTMLElement | null>(null);
	let confirmInput = $state<HTMLElement | null>(null);
	let removeOpen = $state(false);
	let removing = $state(false);

	onMount(() => {
		// This page only applies to local-only mode. A real account uses the
		// account password for at-rest protection.
		if (!get(isLocalOnly)) {
			goto('/settings');
			return;
		}
		enabled = cryptoManager.isLocalPasscodeEnabled();
	});

	const newError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (!newPasscode) return $t('auth.validation.required');
		if (newPasscode.length < MIN_LENGTH)
			return $t('local_mode.passcode.min_length', { values: { min: MIN_LENGTH } });
		return null;
	});

	const confirmError = $derived.by(() => {
		if (!submitAttempted) return null;
		if (confirmPasscode !== newPasscode) return $t('local_mode.passcode.mismatch');
		return null;
	});

	// Soft quality nudge, never a blocker: flags repeated / sequential patterns
	// ("111111", "123456") while typing (audit 012 N6).
	const weakWarning = $derived(
		newPasscode.length >= MIN_LENGTH && isTriviallyGuessablePasscode(newPasscode)
			? $t('local_mode.passcode.weak_warning')
			: null
	);

	const currentError = $derived(currentRejected ? $t('local_mode.passcode.wrong_current') : null);

	function resetForm() {
		currentPasscode = '';
		newPasscode = '';
		confirmPasscode = '';
		submitAttempted = false;
		currentRejected = false;
		saveError = null;
	}

	async function handleSave() {
		submitAttempted = true;
		currentRejected = false;
		saveError = null;
		if (newError || confirmError) {
			(newError ? newInput : confirmInput)?.focus();
			return;
		}
		if (newPasscode.length < MIN_LENGTH || newPasscode !== confirmPasscode) return;

		isSaving = true;
		try {
			if (enabled) {
				const ok = await cryptoManager.changeLocalPasscode(currentPasscode, newPasscode);
				if (ok) {
					toast.success($t('local_mode.passcode.success_changed'));
					resetForm();
				} else {
					currentRejected = true;
				}
			} else {
				await cryptoManager.enableLocalPasscode(newPasscode);
				enabled = true;
				toast.success($t('local_mode.passcode.success_enabled'));
				resetForm();
			}
		} catch (err: unknown) {
			logger.error('Failed to save local passcode:', err);
			saveError = $t('local_mode.passcode.save_failed');
		} finally {
			isSaving = false;
		}
		// The field is disabled while saving; focus it once it is back.
		if (currentRejected) {
			await tick();
			currentInput?.focus();
		}
	}

	async function handleRemove() {
		removing = true;
		try {
			await cryptoManager.disableLocalPasscode();
			enabled = false;
			resetForm();
			removeOpen = false;
			toast.success($t('local_mode.passcode.success_removed'));
		} catch (err: unknown) {
			logger.error('Failed to remove local passcode:', err);
			toast.error($t('local_mode.passcode.save_failed'));
		} finally {
			removing = false;
		}
	}

	function handleLockNow() {
		cryptoManager.lockLocal();
		authOperationsService.getSessionManager().setSession({ hasE2E: false });
		goto('/auth/lock');
	}
</script>

{#snippet revealToggle()}
	<button
		type="button"
		class="absolute inset-y-0 inset-e-0 flex items-center pe-3 text-muted-foreground hover:text-foreground"
		onclick={() => (showPasscode = !showPasscode)}
		aria-label={$t('local_mode.passcode.toggle_visibility')}
	>
		{#if showPasscode}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
	</button>
{/snippet}

<SettingsLayout title={$t('local_mode.passcode.settings_item_title')} backHref="/settings">
	<div class="space-y-6">
		<Alert>
			<Lock class="h-4 w-4" />
			<AlertDescription>{$t('local_mode.passcode.settings_intro')}</AlertDescription>
		</Alert>

		<Card>
			<CardHeader>
				<CardTitle class="text-base flex items-center gap-2">
					<Lock class="h-4 w-4 text-muted-foreground" />
					{enabled
						? $t('local_mode.passcode.change_title')
						: $t('local_mode.passcode.setup_title')}
				</CardTitle>
				<CardDescription>
					{enabled
						? $t('local_mode.passcode.change_desc')
						: $t('local_mode.passcode.setup_desc')}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSave();
					}}
					class="space-y-4"
				>
					{#if enabled}
						<div class="space-y-2">
							<Label for="current-passcode">{$t('local_mode.passcode.current_label')}</Label>
							<div class="relative">
								<Input
									id="current-passcode"
									type={showPasscode ? 'text' : 'password'}
									bind:value={currentPasscode}
									bind:ref={currentInput}
									oninput={() => (currentRejected = false)}
									autocomplete="off"
									disabled={isSaving}
									aria-invalid={currentError ? 'true' : undefined}
									aria-describedby={currentError ? 'current-passcode-error' : undefined}
									class="pe-10 {currentError ? 'border-destructive' : ''}"
								/>
								{@render revealToggle()}
							</div>
							{#if currentError}
								<p id="current-passcode-error" class="text-sm text-destructive">{currentError}</p>
							{/if}
						</div>
					{/if}

					<div class="space-y-2">
						<Label for="new-passcode">{$t('local_mode.passcode.new_label')}</Label>
						<div class="relative">
							<Input
								id="new-passcode"
								type={showPasscode ? 'text' : 'password'}
								bind:value={newPasscode}
								bind:ref={newInput}
								autocomplete="new-password"
								disabled={isSaving}
								aria-invalid={newError ? 'true' : undefined}
								aria-describedby={newError ? 'new-passcode-error' : undefined}
								class="pe-10 {newError ? 'border-destructive' : ''}"
							/>
							{@render revealToggle()}
						</div>
						{#if newError}
							<p id="new-passcode-error" class="text-sm text-destructive">{newError}</p>
						{:else if weakWarning}
							<p class="text-xs text-amber-600 dark:text-amber-400">{weakWarning}</p>
						{:else}
							<p class="text-xs text-muted-foreground">
								{$t('local_mode.passcode.min_length', { values: { min: MIN_LENGTH } })}
							</p>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="confirm-passcode">{$t('local_mode.passcode.confirm_label')}</Label>
						<div class="relative">
							<Input
								id="confirm-passcode"
								type={showPasscode ? 'text' : 'password'}
								bind:value={confirmPasscode}
								bind:ref={confirmInput}
								autocomplete="new-password"
								disabled={isSaving}
								aria-invalid={confirmError ? 'true' : undefined}
								aria-describedby={confirmError ? 'confirm-passcode-error' : undefined}
								class="pe-10 {confirmError ? 'border-destructive' : ''}"
							/>
							{@render revealToggle()}
						</div>
						{#if confirmError}
							<p id="confirm-passcode-error" class="text-sm text-destructive">{confirmError}</p>
						{/if}
					</div>

					{#if saveError}
						<Alert variant="destructive">
							<AlertDescription>{saveError}</AlertDescription>
						</Alert>
					{/if}

					<Button type="submit" disabled={isSaving} class="w-full sm:w-auto">
						{#if isSaving}
							{$t('common.loading')}
						{:else if enabled}
							{$t('local_mode.passcode.change_cta')}
						{:else}
							{$t('local_mode.passcode.setup_cta')}
						{/if}
					</Button>
				</form>
			</CardContent>
		</Card>

		{#if enabled}
			<Card>
				<CardHeader>
					<CardTitle class="text-base flex items-center gap-2">
						<LockKeyhole class="h-4 w-4 text-muted-foreground" />
						{$t('local_mode.passcode.manage_title')}
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-3">
					<div class="flex items-center justify-between gap-4">
						<div>
							<div class="font-medium text-sm">{$t('local_mode.passcode.lock_now_title')}</div>
							<div class="text-sm text-muted-foreground">
								{$t('local_mode.passcode.lock_now_desc')}
							</div>
						</div>
						<Button variant="outline" onclick={handleLockNow}>
							{$t('local_mode.passcode.lock_now_cta')}
						</Button>
					</div>
					<div class="flex items-center justify-between gap-4">
						<div>
							<div class="font-medium text-sm text-destructive">
								{$t('local_mode.passcode.remove_title')}
							</div>
							<div class="text-sm text-muted-foreground">
								{$t('local_mode.passcode.remove_desc')}
							</div>
						</div>
						<Button variant="destructive" onclick={() => (removeOpen = true)}>
							{$t('local_mode.passcode.remove_cta')}
						</Button>
					</div>
				</CardContent>
			</Card>
		{/if}
	</div>
</SettingsLayout>

<Dialog bind:open={removeOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{$t('local_mode.passcode.remove_title')}</DialogTitle>
			<DialogDescription>{$t('local_mode.passcode.remove_confirm_desc')}</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (removeOpen = false)} disabled={removing}>
				{$t('common.cancel')}
			</Button>
			<Button variant="destructive" onclick={handleRemove} disabled={removing}>
				{$t('local_mode.passcode.remove_cta')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
