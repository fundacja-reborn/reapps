<script lang="ts">
	import { SettingsLayout, WebLockSettings } from '@reborn/ui';
	import { cryptoManager, WEB_LOCK_TIMEOUT_PRESETS_MS } from '@reborn/crypto';
	import { t } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { isAuthenticated, isInitialized, isLoading, user } from '$lib/stores/auth.store';
	import {
		enableWebLock,
		disableWebLock,
		isWebLockEnabled,
		lockWebNow,
		setWebLockTimeout
	} from '$lib/services/web-lock.service';

	// App Lock on the web: opt-in, off by default. While it is on, the
	// encryption key is kept in memory only and the account password is needed
	// to open the app. Account sessions only - local-only mode has its passcode.
	let enabled = $state(false);
	let timeoutMs = $state(cryptoManager.getWebLockTimeoutMs());

	function refreshState() {
		enabled = isWebLockEnabled();
		timeoutMs = cryptoManager.getWebLockTimeoutMs();
	}

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
		refreshState();
	});

	async function handleEnable(password: string) {
		const result = await enableWebLock(password);
		refreshState();
		return result;
	}

	async function handleDisable(password: string) {
		const result = await disableWebLock(password);
		refreshState();
		return result;
	}

	function handleTimeout(ms: number) {
		setWebLockTimeout(ms);
		refreshState();
	}
</script>

<SettingsLayout title={$t('web_lock.title')} backHref="/settings">
	<WebLockSettings
		{enabled}
		{timeoutMs}
		timeoutPresets={WEB_LOCK_TIMEOUT_PRESETS_MS}
		username={$user?.username ?? ''}
		showReminderNote
		onEnable={handleEnable}
		onDisable={handleDisable}
		onTimeoutChange={handleTimeout}
		onLockNow={() => void lockWebNow()}
	/>
</SettingsLayout>
