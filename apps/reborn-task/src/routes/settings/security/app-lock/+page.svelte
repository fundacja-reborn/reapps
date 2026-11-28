<script lang="ts">
	import {
		SettingsLayout,
		WebLockSettings,
		Card,
		CardContent,
		CardHeader,
		CardTitle,
		CardDescription,
		Button,
		Alert,
		AlertDescription,
		toast
	} from '@reborn/ui';
	import { cryptoManager, WEB_LOCK_TIMEOUT_PRESETS_MS } from '@reborn/crypto';
	import { Fingerprint, ScanFace, Lock, ShieldAlert } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { isAuthenticated, isInitialized, isLoading, user } from '$lib/stores/auth.store';
	import { createLogger } from '@reborn/utils';
	import { onMount } from 'svelte';
	import { platform } from '$lib/platform';
	import {
		enableWebLock,
		disableWebLock,
		isWebLockEnabled,
		lockWebNow,
		setWebLockTimeout
	} from '$lib/services/web-lock.service';
	import {
		enableAppLock,
		disableAppLock,
		isAppLockEnabled,
		lockNow,
		getAppLockAvailability,
		getTimeoutMs,
		setTimeoutMs,
		TIMEOUT_PRESETS_MS
	} from '$lib/services/app-lock.service';
	import type { BiometryKind } from '$lib/utils/native-biometric-auth';

	const logger = createLogger('AppLockSettingsPage');

	// Two mechanisms under one name, as in re/notes. Web (browser / PWA): the
	// encryption key is kept in memory only and the account password is needed
	// to open the app (guideline 82). Native shell: the key stays in the device
	// vault and biometrics or the device PIN gate reading it (guideline 66) -
	// the web variant cannot work there (the vault holds the key). Account
	// sessions only on both; local-only mode has its passcode.

	// Web variant
	let webEnabled = $state(false);
	let webTimeoutMs = $state(cryptoManager.getWebLockTimeoutMs());

	function refreshWebState() {
		webEnabled = isWebLockEnabled();
		webTimeoutMs = cryptoManager.getWebLockTimeoutMs();
	}

	async function handleWebEnable(password: string) {
		const result = await enableWebLock(password);
		refreshWebState();
		return result;
	}

	async function handleWebDisable(password: string) {
		const result = await disableWebLock(password);
		refreshWebState();
		return result;
	}

	function handleWebTimeout(ms: number) {
		setWebLockTimeout(ms);
		refreshWebState();
	}

	// Native variant
	let enabled = $state(false);
	// null until the device answers, so "Biometrics not set up" never flashes
	// before the real state.
	let available = $state<boolean | null>(null);
	let biometryKind = $state<BiometryKind>('none');
	let timeoutMs = $state(getTimeoutMs());
	let busy = $state(false);

	const biometryLabel = $derived(
		biometryKind === 'none'
			? $t('app_lock.biometry.generic')
			: $t(`app_lock.biometry.${biometryKind}`)
	);

	const timeoutLabels: Record<number, string> = {
		0: 'app_lock.timeout.immediate',
		60000: 'app_lock.timeout.min1',
		300000: 'app_lock.timeout.min5',
		900000: 'app_lock.timeout.min15'
	};

	// Decide once the session has resolved - on a direct load of this URL the
	// store is still bootstrapping when the page mounts.
	let resolved = false;
	$effect(() => {
		if (resolved || !$isInitialized || $isLoading) return;
		resolved = true;
		if (!$isAuthenticated) {
			goto('/settings');
			return;
		}
		if (!__REBORN_NATIVE__) {
			refreshWebState();
			return;
		}
		enabled = isAppLockEnabled();
		refreshAvailability();
	});

	function refreshAvailability() {
		void getAppLockAvailability().then((status) => {
			available = status.isAvailable || status.deviceIsSecure;
			biometryKind = status.kind;
		});
	}

	// Native: coming back from the system settings (a fingerprint or a PIN just
	// added) must update the page without leaving it.
	onMount(() => {
		if (!__REBORN_NATIVE__) return;
		return platform.lifecycle.onResume(() => {
			if (resolved && $isAuthenticated) refreshAvailability();
		});
	});

	async function handleEnable() {
		busy = true;
		try {
			const result = await enableAppLock({
				reason: $t('app_lock.prompt.reason'),
				cancelTitle: $t('app_lock.prompt.cancel'),
				androidTitle: $t('app_lock.prompt.android_title'),
				androidSubtitle: $t('app_lock.prompt.android_subtitle'),
				iosFallbackTitle: ''
			});
			if (result.ok) {
				enabled = true;
				timeoutMs = getTimeoutMs();
				toast.success($t('app_lock.success_enabled'));
			} else if (
				result.code !== 'userCancel' &&
				result.code !== 'systemCancel' &&
				result.code !== 'appCancel'
			) {
				toast.error($t('app_lock.enable_failed'));
			}
		} catch (err: unknown) {
			logger.error('Failed to enable App Lock:', err);
			toast.error($t('app_lock.enable_failed'));
		} finally {
			busy = false;
		}
	}

	function handleDisable() {
		disableAppLock();
		enabled = false;
		toast.success($t('app_lock.success_disabled'));
	}

	function selectTimeout(ms: number) {
		setTimeoutMs(ms);
		timeoutMs = ms;
	}

	function handleLockNow() {
		lockNow();
		goto('/auth/applock?returnTo=%2Fsettings%2Fsecurity%2Fapp-lock');
	}
</script>

{#if !__REBORN_NATIVE__}
	<SettingsLayout title={$t('web_lock.title')} backHref="/settings">
		<WebLockSettings
			enabled={webEnabled}
			timeoutMs={webTimeoutMs}
			timeoutPresets={WEB_LOCK_TIMEOUT_PRESETS_MS}
			username={$user?.username ?? ''}
			showReminderNote
			onEnable={handleWebEnable}
			onDisable={handleWebDisable}
			onTimeoutChange={handleWebTimeout}
			onLockNow={() => void lockWebNow()}
		/>
	</SettingsLayout>
{:else}
	<SettingsLayout title={$t('app_lock.settings_item_title')} backHref="/settings">
		<div class="space-y-6">
			<Alert>
				<Lock class="h-4 w-4" />
				<AlertDescription>{$t('app_lock.settings_intro')}</AlertDescription>
			</Alert>

			{#if available === null}
				<!-- Waiting for the device's answer (a moment). -->
			{:else if !available}
				<Card>
					<CardHeader>
						<CardTitle class="text-base flex items-center gap-2">
							<ShieldAlert class="h-4 w-4 text-muted-foreground" />
							{$t('app_lock.unavailable_title')}
						</CardTitle>
						<CardDescription>{$t('app_lock.unavailable_desc')}</CardDescription>
					</CardHeader>
				</Card>
			{:else}
				<Card>
					<CardHeader>
						<CardTitle class="text-base flex items-center gap-2">
							{#if biometryKind === 'faceId' || biometryKind === 'face'}
								<ScanFace class="h-4 w-4 text-muted-foreground" />
							{:else}
								<Fingerprint class="h-4 w-4 text-muted-foreground" />
							{/if}
							{$t('app_lock.enable_title')}
						</CardTitle>
						<CardDescription>
							{#if biometryKind === 'none'}
								{$t('app_lock.enable_desc_device_credential')}
							{:else}
								{$t('app_lock.enable_desc', { values: { biometry: biometryLabel } })}
							{/if}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{#if enabled}
							<Button variant="outline" onclick={handleDisable} disabled={busy}>
								{$t('app_lock.disable_cta')}
							</Button>
						{:else}
							<Button onclick={handleEnable} disabled={busy} class="w-full sm:w-auto">
								{$t('app_lock.enable_cta')}
							</Button>
						{/if}
					</CardContent>
				</Card>

				{#if enabled}
					<Card>
						<CardHeader>
							<CardTitle class="text-base">{$t('app_lock.timeout_title')}</CardTitle>
							<CardDescription>{$t('app_lock.timeout_desc')}</CardDescription>
						</CardHeader>
						<CardContent class="space-y-2">
							{#each TIMEOUT_PRESETS_MS as ms (ms)}
								<button
									type="button"
									class="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-start text-sm transition-colors hover:bg-muted/50 {timeoutMs ===
									ms
										? 'border-primary bg-primary/5'
										: 'border-border'}"
									onclick={() => selectTimeout(ms)}
								>
									<span class="font-medium">{$t(timeoutLabels[ms])}</span>
									{#if timeoutMs === ms}
										<span class="text-primary text-xs font-semibold">✓</span>
									{/if}
								</button>
							{/each}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle class="text-base">{$t('app_lock.lock_now_title')}</CardTitle>
						</CardHeader>
						<CardContent>
							<div class="flex items-center justify-between gap-4">
								<div class="text-sm text-muted-foreground">{$t('app_lock.lock_now_desc')}</div>
								<Button variant="outline" onclick={handleLockNow}>
									{$t('app_lock.lock_now_cta')}
								</Button>
							</div>
						</CardContent>
					</Card>
				{/if}
			{/if}
		</div>
	</SettingsLayout>
{/if}
