<script lang="ts">
	import { onMount } from 'svelte';
	import {
		SettingsLayout,
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle,
		Button,
		Switch,
		Label,
		toast
	} from '@reborn/ui';
	import { Bell, BellOff, AlertTriangle, Info, Send } from '@lucide/svelte';
	import { appSettings } from '$lib/stores/app-settings.store';
	import { pushNotificationService, type PermissionState } from '$lib/services/push-notification.service';
	import { createLogger } from '@reborn/utils';
	import { t } from '$lib/stores/i18n.store';

	const logger = createLogger('notifications-settings');

	let isLoading = $state(false);
	let isSendingTest = $state(false);
	let permissionState = $state<PermissionState>('default');
	let isSubscribed = $state(false);
	let notificationsEnabled = $state($appSettings?.notifications_enabled ?? false);
	const isMacOS = $derived(
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
	);

	onMount(() => {
		// Sync enabled state from settings store
		const unsub = appSettings.subscribe((settings) => {
			notificationsEnabled = settings?.notifications_enabled ?? false;
		});

		// Detect permission and subscription state
		refreshState();

		return unsub;
	});

	async function refreshState() {
		permissionState = pushNotificationService.getPermission();
		if (permissionState === 'granted') {
			const sub = await pushNotificationService.getSubscription();
			isSubscribed = !!sub;
		} else {
			isSubscribed = false;
		}
	}

	async function handleGrantPermission() {
		isLoading = true;
		try {
			const granted = await pushNotificationService.requestPermission();
			if (granted) {
				permissionState = 'granted';
				toast.success('Uprawnienia do powiadomień zostały przyznane');
			} else {
				permissionState = pushNotificationService.getPermission();
				toast.error('Uprawnienia nie zostały przyznane');
			}
		} finally {
			isLoading = false;
		}
	}

	async function handleSendTestNotification() {
		isSendingTest = true;
		try {
			const ok = await pushNotificationService.sendTestNotification();
			if (ok) {
				toast.success($t('settings.test_notification_sent'));
			} else {
				toast.error($t('settings.test_notification_failed'));
			}
		} catch (err: unknown) {
			logger.error('Failed to send test notification', err);
			toast.error($t('settings.test_notification_failed'));
		} finally {
			isSendingTest = false;
		}
	}

	async function handleToggleNotifications(enabled: boolean) {
		isLoading = true;
		try {
			if (enabled) {
				// Make sure we have permission first
				if (permissionState !== 'granted') {
					const granted = await pushNotificationService.requestPermission();
					if (!granted) {
						permissionState = pushNotificationService.getPermission();
						toast.error('Uprawnienia nie zostały przyznane');
						return;
					}
					permissionState = 'granted';
				}

				// Register subscription
				const sub = await pushNotificationService.subscribe();
				isSubscribed = !!sub;

				// Save to local settings
				await appSettings.update('notifications_enabled', true);
				notificationsEnabled = true;
				toast.success('Powiadomienia zostały włączone');
			} else {
				// Unsubscribe
				await pushNotificationService.unsubscribe();
				isSubscribed = false;

				// Save to local settings
				await appSettings.update('notifications_enabled', false);
				notificationsEnabled = false;
				toast.success('Powiadomienia zostały wyłączone');
			}
		} catch (err: unknown) {
			logger.error('Failed to toggle notifications', err);
			toast.error($t('settings.notification_error.unknown_error'));
		} finally {
			isLoading = false;
		}
	}
</script>

<SettingsLayout title={$t('settings.notifications.title')} backHref="/settings">
	<div class="space-y-6">
		<!-- Not supported -->
		{#if !pushNotificationService.isSupported()}
			<Card class="border-muted">
				<CardContent class="pt-6">
					<div class="flex items-start gap-3">
						<AlertTriangle class="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
						<p class="text-sm text-muted-foreground">
							{$t('settings.notifications_not_supported_browser')}
						</p>
					</div>
				</CardContent>
			</Card>

		<!-- Permission permanently denied -->
		{:else if permissionState === 'denied'}
			<Card class="border-destructive">
				<CardContent class="pt-6">
					<div class="flex items-start gap-3">
						<BellOff class="h-5 w-5 text-destructive mt-0.5 shrink-0" />
						<p class="text-sm text-destructive">
							{$t('settings.notifications_permission_denied_permanently')}
						</p>
					</div>
				</CardContent>
			</Card>

		<!-- Permission not yet granted -->
		{:else if permissionState === 'default'}
			<Card>
				<CardHeader>
					<CardTitle class="text-base flex items-center gap-2">
						<Bell class="h-4 w-4 text-muted-foreground" />
						{$t('settings.notifications.title')}
					</CardTitle>
					<CardDescription>{$t('settings.notifications_description')}</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<p class="text-sm text-muted-foreground">
						{$t('settings.notifications_permission_needed')}
					</p>
					<Button onclick={handleGrantPermission} disabled={isLoading}>
						<Bell class="h-4 w-4 mr-2" />
						{$t('settings.grant_permission')}
					</Button>
				</CardContent>
			</Card>

		<!-- Permission granted — show toggle -->
		{:else}
			<Card>
				<CardHeader>
					<CardTitle class="text-base flex items-center gap-2">
						<Bell class="h-4 w-4 text-muted-foreground" />
						{$t('settings.notifications.title')}
					</CardTitle>
					<CardDescription>{$t('settings.notifications_description')}</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="flex items-center justify-between gap-4">
						<Label for="notifications-switch" class="flex-1 cursor-pointer">
							{$t('settings.enable_notifications_label')}
						</Label>
						<Switch
							id="notifications-switch"
							checked={notificationsEnabled}
							disabled={isLoading}
							onCheckedChange={handleToggleNotifications}
						/>
					</div>

					{#if notificationsEnabled}
						<div class="flex items-start gap-2 rounded-md bg-muted/50 p-3">
							<Info class="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
							<p class="text-xs text-muted-foreground">
								{$t('settings.notifications_info', { values: { hours: '1' } })}
							</p>
						</div>

						{#if isMacOS}
							<div class="flex items-start gap-2 rounded-md bg-muted/50 p-3">
								<Info class="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
								<p class="text-xs text-muted-foreground">
									{$t('settings.notifications_macos_info')}
								</p>
							</div>
						{/if}

						<Button
							variant="outline"
							onclick={handleSendTestNotification}
							disabled={isSendingTest}
						>
							<Send class="h-4 w-4 mr-2" />
							{$t('settings.send_test_notification')}
						</Button>
					{/if}
				</CardContent>
			</Card>
		{/if}
	</div>
</SettingsLayout>
