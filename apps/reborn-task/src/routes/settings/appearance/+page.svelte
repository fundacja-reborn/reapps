<script lang="ts">
	import { onMount } from 'svelte';
	import {
		SettingsLayout,
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle,
		ThemePicker,
		DateTimeFormatCard,
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger,
		Button
	} from '@reborn/ui';
	import { Globe } from '@lucide/svelte';
	import {
		appSettings,
		currentTheme,
		currentLanguage,
		dateFormat,
		timeFormat
	} from '$lib/stores/app-settings.store';
	import { t } from '$lib/stores/i18n.store';
	import { SUPPORTED_LOCALES } from '@reborn/i18n';
	import type { AppSettings } from '@reborn/storage';
	import { createLogger } from '@reborn/utils';
	import { toast } from '@reborn/ui';

	const logger = createLogger('appearance-settings');

	let isLoading = $state(false);
	let error = $state<string | null>(null);

	let theme = $state($currentTheme);
	let language = $state($currentLanguage);
	let dateFormatValue = $state($dateFormat);
	let timeFormatValue = $state($timeFormat);

	const languageOptions = [
		{ value: 'en', label: 'English' },
		{ value: 'pl', label: 'Polski' },
		{ value: 'de', label: 'Deutsch' },
		{ value: 'es', label: 'Español' },
		{ value: 'fr', label: 'Français' }
	] as const;

	const dateFormatOptions = [
		{ value: 'DD/MM/YYYY', label: '31/12/2024' },
		{ value: 'DD.MM.YYYY', label: '31.12.2024' },
		{ value: 'YYYY-MM-DD', label: '2024-12-31' },
		{ value: 'MM/DD/YYYY', label: '12/31/2024' }
	];

	const timeFormatOptions = [
		{ value: '24h', label: $t('appearance.time_24h') },
		{ value: '12h', label: $t('appearance.time_12h') }
	];

	async function updateTheme(value: 'light' | 'dark' | 'system') {
		try {
			isLoading = true;
			error = null;
			await appSettings.update('theme', value);
			theme = value;
			toast.success($t('theme.updated'));
		} catch (err: unknown) {
			logger.error('Failed to update theme', err);
			error = $t('settings.appearance.error_update');
			toast.error($t('settings.appearance.error_update'));
		} finally {
			isLoading = false;
		}
	}

	async function updateLanguage(value: string | undefined) {
		if (!value || !SUPPORTED_LOCALES.includes(value as AppSettings['language'])) return;
		const locale = value as AppSettings['language'];
		try {
			isLoading = true;
			error = null;
			await appSettings.update('language', locale);
			language = locale;
			toast.success($t('settings.appearance.language_updated'));
		} catch (err: unknown) {
			logger.error('Failed to update language', err);
			error = $t('settings.appearance.error_update');
			toast.error($t('settings.appearance.error_update'));
		} finally {
			isLoading = false;
		}
	}

	async function updateDateFormat(value: string) {
		try {
			isLoading = true;
			error = null;
			await appSettings.update('dateFormat', value);
			dateFormatValue = value;
			toast.success($t('settings.appearance.date_format_updated'));
		} catch (err: unknown) {
			logger.error('Failed to update date format', err);
			error = $t('settings.appearance.error_update');
			toast.error($t('settings.appearance.error_update'));
		} finally {
			isLoading = false;
		}
	}

	async function updateTimeFormat(value: string) {
		try {
			isLoading = true;
			error = null;
			await appSettings.update('timeFormat', value as '12h' | '24h');
			timeFormatValue = value as '12h' | '24h';
			toast.success($t('settings.appearance.time_format_updated'));
		} catch (err: unknown) {
			logger.error('Failed to update time format', err);
			error = $t('settings.appearance.error_update');
			toast.error($t('settings.appearance.error_update'));
		} finally {
			isLoading = false;
		}
	}

	async function resetToDefaults() {
		try {
			isLoading = true;
			error = null;
			await appSettings.reset();
			theme = $currentTheme;
			language = $currentLanguage;
			dateFormatValue = $dateFormat;
			timeFormatValue = $timeFormat;
			toast.success($t('settings.appearance.reset_done'));
		} catch (err: unknown) {
			logger.error('Failed to reset settings', err);
			error = $t('settings.appearance.error_update');
			toast.error($t('settings.appearance.error_update'));
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		const unsubscribes = [
			currentTheme.subscribe((value) => (theme = value)),
			currentLanguage.subscribe((value) => (language = value)),
			dateFormat.subscribe((value) => (dateFormatValue = value)),
			timeFormat.subscribe((value) => (timeFormatValue = value))
		];
		return () => unsubscribes.forEach((fn) => fn());
	});
</script>

<SettingsLayout title={$t('settings.appearance.title')} backHref="/settings">
	<div class="space-y-6">
		{#if error}
			<Card class="border-destructive">
				<CardContent class="pt-6">
					<p class="text-sm text-destructive">{error}</p>
				</CardContent>
			</Card>
		{/if}

		<!-- Theme -->
		<Card>
			<CardHeader>
				<CardTitle class="text-base">{$t('settings.appearance.theme')}</CardTitle>
				<CardDescription>{$t('settings.appearance.theme_desc')}</CardDescription>
			</CardHeader>
			<CardContent>
				<ThemePicker
					value={theme}
					onchange={updateTheme}
					disabled={isLoading}
					labels={{ light: $t('theme.light'), dark: $t('theme.dark'), system: $t('theme.system') }}
				/>
			</CardContent>
		</Card>

		<!-- Language -->
		<Card>
			<CardHeader>
				<CardTitle class="text-base flex items-center gap-2">
					<Globe class="h-4 w-4 text-muted-foreground" />
					{$t('settings.appearance.language')}
				</CardTitle>
				<CardDescription>{$t('settings.appearance.language_desc')}</CardDescription>
			</CardHeader>
			<CardContent>
				<Select
					type="single"
					value={language}
					onValueChange={(value) => updateLanguage(value)}
					disabled={isLoading}
				>
					<SelectTrigger class="w-full">
						{languageOptions.find((o) => o.value === language)?.label ??
							$t('appearance.select_language')}
					</SelectTrigger>
					<SelectContent>
						{#each languageOptions as option}
							<SelectItem value={option.value}>{option.label}</SelectItem>
						{/each}
					</SelectContent>
				</Select>
			</CardContent>
		</Card>

		<!-- Date & Time -->
		<DateTimeFormatCard
			dateFormat={dateFormatValue}
			timeFormat={timeFormatValue}
			{dateFormatOptions}
			{timeFormatOptions}
			onDateFormatChange={updateDateFormat}
			onTimeFormatChange={updateTimeFormat}
			disabled={isLoading}
			labels={{
				title: $t('settings.appearance.date_time'),
				description: $t('settings.appearance.date_time_desc'),
				dateLabel: $t('settings.appearance.date_format'),
				timeLabel: $t('settings.appearance.time_format'),
				datePlaceholder: $t('appearance.select_date_format'),
				timePlaceholder: $t('appearance.select_time_format')
			}}
		/>

		<div class="pt-2">
			<Button
				variant="outline"
				onclick={resetToDefaults}
				disabled={isLoading}
				class="w-full sm:w-auto"
			>
				{$t('settings.appearance.reset')}
			</Button>
		</div>
	</div>
</SettingsLayout>
