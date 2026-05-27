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
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger,
		toast
	} from '@reborn/ui';
	import { Bell, BellOff, AlertTriangle, Info, Send, Clock } from '@lucide/svelte';
	import { appSettings } from '$lib/stores/app-settings.store';
	import {
		pushNotificationService,
		type PermissionState,
		DEFAULT_NOTIFICATION_LEAD_MINUTES,
		DEFAULT_NOTIFICATION_ALL_DAY_TIME
	} from '$lib/services/push-notification.service';
	import { createLogger } from '@reborn/utils';
	import { t } from '$lib/stores/i18n.store';

	const logger = createLogger('notifications-settings');

	let isLoading = $state(false);
	let isSendingTest = $state(false);
	let permissionState = $state<PermissionState>('default');
	let isSubscribed = $state(false);
	let notificationsEnabled = $state($appSettings?.notifications_enabled ?? false);
	let leadMinutes = $state<number>(
		$appSettings?.notification_lead_minutes ?? DEFAULT_NOTIFICATION_LEAD_MINUTES
	);
	let allDayTime = $state<string>(
		$appSettings?.notification_all_day_time ?? DEFAULT_NOTIFICATION_ALL_DAY_TIME
	);
	let backgroundDelivery = $state<boolean>(
		$appSettings?.notification_background_delivery ?? true
	);
	const isMacOS = $derived(
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
	);

	const leadOptions = $derived([
		{ value: '15', label: $t('settings.notification_lead.options.15min') },
		{ value: '30', label: $t('settings.notification_lead.options.30min') },
		{ value: '60', label: $t('settings.notification_lead.options.1h') },
		{ value: '120', label: $t('settings.notification_lead.options.2h') },
		{ value: '360', label: $t('settings.notification_lead.options.6h') },
		{ value: '720', label: $t('settings.notification_lead.options.12h') },
		{ value: '1440', label: $t('settings.notification_lead.options.24h') }
	]);

	const leadLabel = $derived(
		leadOptions.find((o) => Number(o.value) === leadMinutes)?.label ?? leadOptions[2].label
	);

	onMount(() => {
		// Sync enabled state from settings store
		const unsub = appSettings.subscribe((settings) => {
			notificationsEnabled = settings?.notifications_enabled ?? false;
			leadMinutes = settings?.notification_lead_minutes ?? DEFAULT_NOTIFICATION_LEAD_MINUTES;
			allDayTime = settings?.notification_all_day_time ?? DEFAULT_NOTIFICATION_ALL_DAY_TIME;
			backgroundDelivery = settings?.notification_background_delivery ?? true;
		});

		// Detect permission and subscription state
		refreshState();

		return unsub;
	});

	async function updateLeadMinutes(value: string) {
		const minutes = Number(value);
		if (!Number.isFinite(minutes) || minutes < 0) return;
		try {
			await appSettings.update('notification_lead_minutes', minutes);
		} catch (err: unknown) {
			logger.error('Failed to update notification_lead_minutes', err);
			toast.error($t('settings.notification_error.unknown_error'));
		}
	}

	async function updateAllDayTime(value: string) {
		// Basic HH:MM validation; native input enforces format but be defensive.
		if (!/^\d{1,2}:\d{2}$/.test(value)) return;
		// Snap to 5-minute bucket so the stored time matches the server-side
		// scheduling granularity (cron fires every 5 min, fire_at is bucketed).
		const [hStr, mStr] = value.split(':');
		const h = Number(hStr);
		const m = Math.floor(Number(mStr) / 5) * 5;
		const snapped = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
		try {
			await appSettings.update('notification_all_day_time', snapped);
		} catch (err: unknown) {
			logger.error('Failed to update notification_all_day_time', err);
			toast.error($t('settings.notification_error.unknown_error'));
		}
	}

	async function updateBackgroundDelivery(enabled: boolean) {
		try {
			await appSettings.update('notification_background_delivery', enabled);
			backgroundDelivery = enabled;
		} catch (err: unknown) {
			logger.error('Failed to update notification_background_delivery', err);
			toast.error($t('settings.notification_error.unknown_error'));
		}
	}

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
				toast.success($t('settings.notification_permission_granted_toast'));
			} else {
				permissionState = pushNotificationService.getPermission();
				toast.error($t('settings.notification_permission_not_granted_toast'));
			}
		} finally {
			isLoading = false;
		}
	}

	async function handleSendTestNotification() {
		isSendingTest = true;
		try {
			const ok = await pushNotificationService.sendTestNotification(
				$t('settings.test_notification_body')
			);
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
						toast.error($t('settings.notification_permission_not_granted_toast'));
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
				toast.success($t('settings.notifications_enabled_toast'));
			} else {
				// Unsubscribe
				await pushNotificationService.unsubscribe();
				isSubscribed = false;

				// Save to local settings
				await appSettings.update('notifications_enabled', false);
				notificationsEnabled = false;
				toast.success($t('settings.notifications_disabled_toast'));
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

		<!-- Permission granted - show toggle -->
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
						<!-- Lead time for tasks with a specific time -->
						<div class="space-y-2">
							<Label for="notification-lead" class="flex items-center gap-2">
								<Clock class="h-4 w-4 text-muted-foreground" />
								{$t('settings.notification_lead.label')}
							</Label>
							<Select
								type="single"
								value={String(leadMinutes)}
								onValueChange={(value) => updateLeadMinutes(value)}
								disabled={isLoading}
							>
								<SelectTrigger id="notification-lead" class="w-full">
									{leadLabel}
								</SelectTrigger>
								<SelectContent>
									{#each leadOptions as option (option.value)}
										<SelectItem value={option.value}>{option.label}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
							<p class="text-xs text-muted-foreground">
								{$t('settings.notification_lead.help')}
							</p>
						</div>

						<!-- All-day time for date-only tasks -->
						<div class="space-y-2">
							<Label for="notification-all-day-time" class="flex items-center gap-2">
								<Clock class="h-4 w-4 text-muted-foreground" />
								{$t('settings.notification_all_day_time.label')}
							</Label>
							<input
								id="notification-all-day-time"
								type="time"
								step="300"
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								value={allDayTime}
								disabled={isLoading}
								onchange={(e) =>
									updateAllDayTime((e.target as HTMLInputElement).value)}
							/>
							<p class="text-xs text-muted-foreground">
								{$t('settings.notification_all_day_time.help')}
							</p>
						</div>

						<!-- Background delivery (server-assisted) opt-in/out -->
						<div class="space-y-2 rounded-md border border-border p-3">
							<div class="flex items-center justify-between gap-4">
								<Label for="notification-background-delivery" class="flex-1 cursor-pointer">
									{$t('settings.notification_background_delivery.label')}
								</Label>
								<Switch
									id="notification-background-delivery"
									checked={backgroundDelivery}
									disabled={isLoading}
									onCheckedChange={updateBackgroundDelivery}
								/>
							</div>
							<p class="text-xs text-muted-foreground">
								{$t('settings.notification_background_delivery.help')}
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
