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
	import { Bell, BellOff, AlertTriangle, Info, Send, Clock, AlarmClock } from '@lucide/svelte';
	import { appSettings } from '$lib/stores/app-settings.store';
	import { pushSyncError } from '$lib/stores/push-sync-error.store';
	import {
		pushNotificationService,
		type PermissionState,
		DEFAULT_NOTIFICATION_LEAD_MINUTES,
		DEFAULT_NOTIFICATION_ALL_DAY_TIME
	} from '$lib/services/push-notification.service';
	import { createLogger } from '@reborn/utils';
	import { t } from '$lib/stores/i18n.store';
	import { platform } from '$lib/platform';
	import {
		canOpenNotificationSettings,
		getExactAlarmState,
		getNativeNotificationPermission,
		openExactAlarmSettings,
		openNotificationSettings,
		requestNativeNotificationPermission,
		sendNativeTestNotification,
		type ExactAlarmState,
		type NativeNotificationPermission
	} from '$lib/services/native-reminders';
	import { requestNativeReminderReplan } from '$lib/services/native-reminder-sync';

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
		!__REBORN_NATIVE__ &&
			typeof navigator !== 'undefined' &&
			/Mac|iPhone|iPad/.test(navigator.platform)
	);

	// Native shells: reminders are device-local notifications planned on the
	// phone (native-reminders.ts) - no Service Worker, no server schedule, so
	// no "background delivery" switch. Android 12+ adds the exact-alarm
	// permission; iOS can open the app's page in Settings.
	let exactAlarms = $state<ExactAlarmState>('unsupported');
	let canOpenSystemSettings = $state(false);
	const supported = __REBORN_NATIVE__ || pushNotificationService.isSupported();

	function fromNative(permission: NativeNotificationPermission): PermissionState {
		return permission === 'prompt' ? 'default' : permission;
	}

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

		// Native: the user may come back from the system settings with a
		// different notification or exact-alarm permission.
		const offResume = __REBORN_NATIVE__
			? platform.lifecycle.onResume(() => void refreshState())
			: undefined;

		return () => {
			unsub();
			offResume?.();
		};
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
		if (__REBORN_NATIVE__) {
			permissionState = fromNative(await getNativeNotificationPermission());
			exactAlarms = await getExactAlarmState();
			canOpenSystemSettings = await canOpenNotificationSettings();
			return;
		}
		permissionState = pushNotificationService.getPermission();
		if (permissionState === 'granted') {
			const sub = await pushNotificationService.getSubscription();
			isSubscribed = !!sub;
		} else {
			isSubscribed = false;
		}
	}

	/** Ask for the system permission; true when granted. */
	async function requestPermission(): Promise<boolean> {
		if (__REBORN_NATIVE__) {
			permissionState = fromNative(await requestNativeNotificationPermission());
			if (permissionState === 'granted') {
				exactAlarms = await getExactAlarmState();
				requestNativeReminderReplan();
			}
			return permissionState === 'granted';
		}
		const granted = await pushNotificationService.requestPermission();
		permissionState = granted ? 'granted' : pushNotificationService.getPermission();
		return granted;
	}

	async function handleGrantPermission() {
		isLoading = true;
		try {
			if (await requestPermission()) {
				toast.success($t('settings.notification_permission_granted_toast'));
			} else {
				toast.error($t('settings.notification_permission_not_granted_toast'));
			}
		} finally {
			isLoading = false;
		}
	}

	// iOS only (the button shows where `canOpenSystemSettings`).
	async function handleOpenSystemSettings() {
		await openNotificationSettings();
	}

	async function handleAllowExactAlarms() {
		isLoading = true;
		try {
			exactAlarms = await openExactAlarmSettings();
			if (exactAlarms === 'granted') {
				toast.success($t('settings.notifications_native.exact_on'));
				requestNativeReminderReplan();
			} else {
				toast.info($t('settings.notifications_native.exact_still_off'));
			}
		} finally {
			isLoading = false;
		}
	}

	async function handleSendTestNotification() {
		isSendingTest = true;
		try {
			const ok = __REBORN_NATIVE__
				? await sendNativeTestNotification('re/task', $t('settings.test_notification_body'))
				: await pushNotificationService.sendTestNotification(
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
				if (permissionState !== 'granted' && !(await requestPermission())) {
					toast.error($t('settings.notification_permission_not_granted_toast'));
					return;
				}

				// Register subscription (web; the native shells plan on the device)
				if (!__REBORN_NATIVE__) {
					const sub = await pushNotificationService.subscribe();
					isSubscribed = !!sub;
				}

				// Save to local settings
				await appSettings.update('notifications_enabled', true);
				notificationsEnabled = true;
				toast.success($t('settings.notifications_enabled_toast'));
			} else {
				// Unsubscribe (web; the planner cancels the native reminders)
				if (!__REBORN_NATIVE__) {
					await pushNotificationService.unsubscribe();
					isSubscribed = false;
				}

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
		{#if !supported}
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
						{#if __REBORN_NATIVE__}
							<div class="space-y-3">
								<p class="text-sm text-destructive">
									{$t('settings.notifications_native.denied')}
								</p>
								{#if canOpenSystemSettings}
									<Button variant="outline" onclick={handleOpenSystemSettings}>
										{$t('settings.notifications_native.open_settings_btn')}
									</Button>
								{:else}
									<p class="text-sm text-muted-foreground">
										{$t('settings.notifications_native.denied_android')}
									</p>
								{/if}
							</div>
						{:else}
							<p class="text-sm text-destructive">
								{$t('settings.notifications_permission_denied_permanently')}
							</p>
						{/if}
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
					<CardDescription>
						{__REBORN_NATIVE__
							? $t('settings.notifications_native.description')
							: $t('settings.notifications_description')}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<p class="text-sm text-muted-foreground">
						{$t('settings.notifications_permission_needed')}
					</p>
					<Button onclick={handleGrantPermission} disabled={isLoading}>
						<Bell class="h-4 w-4 me-2" />
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
					<CardDescription>
						{__REBORN_NATIVE__
							? $t('settings.notifications_native.description')
							: $t('settings.notifications_description')}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if $pushSyncError && notificationsEnabled}
						<div class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
							<AlertTriangle class="h-4 w-4 text-destructive mt-0.5 shrink-0" />
							<div class="flex-1 space-y-1">
								<p class="text-sm text-destructive font-medium">
									{$t('settings.notification_sync_error.title')}
								</p>
								<p class="text-xs text-muted-foreground">
									{$t('settings.notification_sync_error.help')}
								</p>
								<p class="text-xs text-muted-foreground font-mono break-all">
									{$pushSyncError}
								</p>
							</div>
						</div>
					{/if}
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

						{#if __REBORN_NATIVE__}
							<!-- Android 12+: without exact alarms a reminder may come late -->
							{#if exactAlarms === 'denied'}
								<div class="space-y-2 rounded-md border border-border p-3">
									<p class="flex items-center gap-2 text-sm font-medium">
										<AlarmClock class="h-4 w-4 text-muted-foreground" />
										{$t('settings.notifications_native.exact_title')}
									</p>
									<p class="text-xs text-muted-foreground">
										{$t('settings.notifications_native.exact_help')}
									</p>
									<Button variant="outline" onclick={handleAllowExactAlarms} disabled={isLoading}>
										{$t('settings.notifications_native.exact_btn')}
									</Button>
								</div>
							{/if}

							<div class="flex items-start gap-2 rounded-md bg-muted/50 p-3">
								<Info class="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
								<p class="text-xs text-muted-foreground">
									{$t('settings.notifications_native.other_devices')}
								</p>
							</div>
						{:else}
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
						{/if}

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
							<Send class="h-4 w-4 me-2" />
							{$t('settings.send_test_notification')}
						</Button>
					{/if}
				</CardContent>
			</Card>
		{/if}
	</div>
</SettingsLayout>
