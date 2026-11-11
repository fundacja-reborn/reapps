<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsLayout,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    ThemePicker,
    DateTimeFormatCard,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Button
  } from '@reborn/ui';
  import { Globe, ImageIcon } from '@lucide/svelte';
  import {
    appSettings,
    currentTheme,
    currentLanguage,
    dateFormat,
    timeFormat,
    imageLoadMode as imageLoadModeStore,
    weekStartPreference
  } from '$lib/stores/app-settings.store';
  import type { ImageLoadMode } from '@reborn/storage';
  import { t } from '$lib/stores/i18n.store';
  import {
    SUPPORTED_LOCALES,
    WEEK_START_PREFERENCES,
    isWeekStartPreference,
    localeLabel,
    resolveWeekStart,
    weekdayName
  } from '@reborn/i18n';
  import type { AppSettings } from '@reborn/storage';
  import { SETTINGS_DATE_FORMAT_OPTIONS, createLogger } from '@reborn/utils';
  import { toast } from '@reborn/ui';
  import { devicePrefs } from '$lib/stores/device-prefs.store';
  import TextSizeCard from '$lib/components/settings/TextSizeCard.svelte';

  const logger = createLogger('appearance-settings');

  let isLoading = $state(false);
  let error = $state<string | null>(null);

  let theme = $state<'light' | 'dark' | 'system'>('system');
  let language = $state<string>('en');
  let dateFormatValue = $state('DD/MM/YYYY');
  let timeFormatValue = $state('24h');
  let imageLoadModeValue = $state<ImageLoadMode>('ask');
  let weekStartValue = $state('auto');

  const languageOptions = SUPPORTED_LOCALES.map((value) => ({ value, label: localeLabel(value) }));

  const dateFormatOptions = SETTINGS_DATE_FORMAT_OPTIONS;

  const timeFormatOptions = [
    { value: '24h', label: $t('appearance.time_24h') },
    { value: '12h', label: $t('appearance.time_12h') }
  ];

  const WEEK_START_LABEL_KEYS = {
    6: 'appearance.week_start_saturday',
    0: 'appearance.week_start_sunday',
    1: 'appearance.week_start_monday'
  } as const;

  // 'Automatic' names the day it resolves to for the current language (#493).
  let weekStartOptions = $derived(
    WEEK_START_PREFERENCES.map((value) => ({
      value: String(value),
      label:
        value === 'auto'
          ? $t('appearance.week_start_auto', {
              values: { day: weekdayName(resolveWeekStart('auto', language), language) }
            })
          : $t(WEEK_START_LABEL_KEYS[value])
    }))
  );

  async function updateTheme(value: 'light' | 'dark' | 'system') {
    try {
      isLoading = true;
      error = null;
      await appSettings.update('theme', value);
      theme = value;
      toast.success($t('theme.updated'));
    } catch (err: unknown) {
      logger.error('Failed to update theme', err);
      toast.error($t('settings_page.appearance.date_format_updated'));
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
      toast.success($t('settings_page.appearance.language_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update language', err);
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
      toast.success($t('settings_page.appearance.date_format_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update date format', err);
    } finally {
      isLoading = false;
    }
  }

  async function updateImageLoadMode(value: string | undefined) {
    if (!value) return;
    try {
      isLoading = true;
      error = null;
      await appSettings.update('imageLoadMode', value as ImageLoadMode);
      imageLoadModeValue = value as ImageLoadMode;
      toast.success($t('settings_page.appearance.image_loading_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update image load mode', err);
    } finally {
      isLoading = false;
    }
  }

  async function updateTimeFormat(value: string) {
    try {
      isLoading = true;
      error = null;
      await appSettings.update('timeFormat', value as '12h' | '24h');
      timeFormatValue = value;
      toast.success($t('settings_page.appearance.time_format_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update time format', err);
    } finally {
      isLoading = false;
    }
  }

  async function updateWeekStart(value: string) {
    const preference: unknown = value === 'auto' ? 'auto' : Number(value);
    if (!isWeekStartPreference(preference)) return;
    try {
      isLoading = true;
      error = null;
      await appSettings.update('weekStart', preference);
      weekStartValue = value;
      toast.success($t('appearance.week_start_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update first day of the week', err);
    } finally {
      isLoading = false;
    }
  }

  async function handleReset() {
    try {
      isLoading = true;
      error = null;
      await appSettings.reset();
      // Text size is per device (not in the synced settings) but lives on this
      // page, so "Reset to defaults" covers it too.
      devicePrefs.resetTextSize();
      theme = 'system';
      language = 'en';
      dateFormatValue = 'DD/MM/YYYY';
      timeFormatValue = '24h';
      imageLoadModeValue = 'ask';
      weekStartValue = 'auto';
      toast.success($t('settings_page.appearance.reset_done'));
    } catch (err: unknown) {
      logger.error('Failed to reset settings', err);
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    const unsubscribes = [
      currentTheme.subscribe((value) => (theme = value)),
      currentLanguage.subscribe((value) => (language = value)),
      dateFormat.subscribe((value) => (dateFormatValue = value)),
      timeFormat.subscribe((value) => (timeFormatValue = value)),
      imageLoadModeStore.subscribe((value) => (imageLoadModeValue = value)),
      weekStartPreference.subscribe((value) => (weekStartValue = String(value)))
    ];
    return () => unsubscribes.forEach((fn) => fn());
  });
</script>

<svelte:head>
  <title>{$t('settings_page.appearance.title')} - re/notes</title>
</svelte:head>

<SettingsLayout title={$t('settings_page.appearance.title')} backHref="/settings">
  <div class="space-y-6 px-4 sm:px-0">
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
        <CardTitle class="text-base">{$t('settings_page.appearance.theme')}</CardTitle>
        <CardDescription>{$t('settings_page.appearance.theme_desc')}</CardDescription>
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

    <!-- Text size (this device only) -->
    <TextSizeCard />

    <!-- Language -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Globe class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.appearance.language')}
        </CardTitle>
        <CardDescription>{$t('settings_page.appearance.language_desc')}</CardDescription>
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
      weekStart={weekStartValue}
      {weekStartOptions}
      onWeekStartChange={updateWeekStart}
      disabled={isLoading}
      labels={{
        title: $t('settings_page.appearance.date_time'),
        description: $t('settings_page.appearance.date_time_desc'),
        dateLabel: $t('settings_page.appearance.date_format'),
        timeLabel: $t('settings_page.appearance.time_format'),
        datePlaceholder: $t('appearance.select_date_format'),
        timePlaceholder: $t('appearance.select_time_format'),
        weekStartLabel: $t('appearance.week_start'),
        weekStartPlaceholder: $t('appearance.select_week_start')
      }}
    />

    <!-- Image Loading -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <ImageIcon class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.appearance.image_loading')}
        </CardTitle>
        <CardDescription>{$t('settings_page.appearance.image_loading_desc')}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <Select
          type="single"
          value={imageLoadModeValue}
          onValueChange={(value) => updateImageLoadMode(value)}
          disabled={isLoading}
        >
          <SelectTrigger class="w-full">
            {imageLoadModeValue === 'ask'
              ? $t('settings_page.appearance.image_loading_ask')
              : imageLoadModeValue === 'always'
                ? $t('settings_page.appearance.image_loading_always')
                : $t('settings_page.appearance.image_loading_never')}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ask">{$t('settings_page.appearance.image_loading_ask')}</SelectItem>
            <SelectItem value="always"
              >{$t('settings_page.appearance.image_loading_always')}</SelectItem
            >
            <SelectItem value="never"
              >{$t('settings_page.appearance.image_loading_never')}</SelectItem
            >
          </SelectContent>
        </Select>
        {#if imageLoadModeValue === 'always'}
          <p class="text-xs text-amber-600 dark:text-amber-400">
            {$t('settings_page.appearance.image_loading_warning')}
          </p>
        {/if}
      </CardContent>
    </Card>

    <!-- Reset -->
    <div class="pt-2">
      <Button variant="outline" onclick={handleReset} disabled={isLoading} class="w-full sm:w-auto">
        {$t('settings_page.appearance.reset')}
      </Button>
    </div>
  </div>
</SettingsLayout>
