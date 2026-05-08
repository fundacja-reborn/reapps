<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsLayout,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Switch,
    toastStore
  } from '@reborn/ui';
  import { CalendarDays, CalendarRange, CalendarClock } from '@lucide/svelte';
  import {
    appSettings,
    periodicNotesSettings,
    currentLanguage
  } from '$lib/stores/app-settings.store';
  import {
    PERIODIC_NOTES_DEFAULTS,
    PERIODIC_NOTES_DEFAULT_FORMATS
  } from '@reborn/storage';
  import type { PeriodicKind, PeriodicNotesSettings, PeriodicKindSettings } from '@reborn/storage';
  import FolderTreePicker from '$lib/components/folders/FolderTreePicker.svelte';
  import { t } from '$lib/stores/i18n.store';
  import {
    formatRange,
    buildPeriodicTitle
  } from '$lib/services/periodic-notes-format';
  import { createLogger } from '@reborn/utils';

  const logger = createLogger('settings-periodic-notes');

  // Snapshot used for inputs / dropdowns; mirrors the derived store.
  let local = $state<PeriodicNotesSettings>(structuredClone(PERIODIC_NOTES_DEFAULTS));

  const PRESETS: Record<PeriodicKind, string[]> = {
    daily: ['YYYY-MM-DD dddd', 'YYYY-MM-DD ddd', 'YYYY-MM-DD', 'dddd, D MMMM YYYY'],
    weekly: ['YYYY-MM-DD [W]ww', 'YYYY-[W]ww', 'YYYY-MM-DD', '[Week] ww, YYYY'],
    monthly: ['YYYY-MM', 'MMMM YYYY', 'YYYY MMMM']
  };

  // Refresh the live preview every minute so it follows clock changes.
  let now = $state(new Date());
  $effect(() => {
    const id = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(id);
  });

  async function persist(updates: Partial<PeriodicNotesSettings>) {
    const next: PeriodicNotesSettings = {
      daily: { ...local.daily, ...updates.daily },
      weekly: { ...local.weekly, ...updates.weekly },
      monthly: { ...local.monthly, ...updates.monthly }
    };
    local = next;
    try {
      await appSettings.update('periodicNotes', next);
    } catch (err) {
      logger.error('Failed to update periodicNotes', err);
      toastStore.error($t('notes.errors.save_failed'));
    }
  }

  function patchKind(kind: PeriodicKind, partial: Partial<PeriodicKindSettings>) {
    return persist({ [kind]: { ...local[kind], ...partial } } as Partial<PeriodicNotesSettings>);
  }

  function previewName(kind: PeriodicKind): string {
    return buildPeriodicTitle(
      kind,
      now,
      local[kind].format,
      PERIODIC_NOTES_DEFAULT_FORMATS[kind],
      $currentLanguage
    );
  }

  function previewRange(kind: PeriodicKind): string {
    return formatRange(kind, now, $currentLanguage);
  }

  onMount(() => {
    return periodicNotesSettings.subscribe((value) => {
      local = structuredClone(value);
      // Heal legacy custom formats (set outside PRESETS, e.g. via direct
      // IndexedDB edits) by reverting to the locale default.
      for (const kind of ['daily', 'weekly', 'monthly'] as const) {
        if (!PRESETS[kind].includes(local[kind].format)) {
          patchKind(kind, { format: PERIODIC_NOTES_DEFAULT_FORMATS[kind] });
        }
      }
    });
  });

  const KINDS = [
    { kind: 'daily' as const, icon: CalendarDays },
    { kind: 'weekly' as const, icon: CalendarRange },
    { kind: 'monthly' as const, icon: CalendarClock }
  ];
</script>

<svelte:head>
  <title>{$t('notes.periodic.settings.title')} — re/notes</title>
</svelte:head>

<SettingsLayout title={$t('notes.periodic.settings.title')} backHref="/settings">
  <p class="text-sm text-muted-foreground mb-6 px-4 sm:px-0">
    {$t('notes.periodic.settings.description')}
  </p>

  <div class="space-y-6 px-4 sm:px-0">
    {#each KINDS as { kind, icon: Icon } (kind)}
      <Card>
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <Icon class="h-4 w-4 text-muted-foreground" />
            {$t(`notes.periodic.${kind}.settings.section`)}
          </CardTitle>
          <CardDescription>{$t(`notes.periodic.${kind}.button.label`)}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <!-- Toggle: show button in nav -->
          <div class="flex items-center justify-between gap-4">
            <label for="enabled-{kind}" class="text-sm font-medium cursor-pointer">
              {$t('notes.periodic.settings.show_button')}
            </label>
            <Switch
              id="enabled-{kind}"
              checked={local[kind].enabled}
              onCheckedChange={(v: boolean) => patchKind(kind, { enabled: v })}
            />
          </div>

          <!-- Folder picker -->
          <div class="space-y-1.5">
            <label for="folder-{kind}" class="text-sm font-medium">
              {$t('notes.periodic.settings.folder')}
            </label>
            <FolderTreePicker
              id="folder-{kind}"
              value={local[kind].folderId}
              defaultFolderName={$t(`notes.periodic.${kind}.folder.default`)}
              label={$t('notes.periodic.settings.folder_pick')}
              onselect={(folderId) => patchKind(kind, { folderId })}
            />
          </div>

          <!-- Format preset dropdown -->
          <div class="space-y-1.5">
            <label for="format-{kind}" class="text-sm font-medium">
              {$t('notes.periodic.settings.format')}
            </label>
            <Select
              type="single"
              value={local[kind].format}
              onValueChange={(value) => {
                if (value) patchKind(kind, { format: value });
              }}
            >
              <SelectTrigger id="format-{kind}" class="w-full">
                {local[kind].format}
              </SelectTrigger>
              <SelectContent>
                {#each PRESETS[kind] as preset (preset)}
                  <SelectItem value={preset}>{preset}</SelectItem>
                {/each}
              </SelectContent>
            </Select>
          </div>

          <!-- Live preview -->
          <div class="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <div class="text-xs text-muted-foreground mb-0.5">
              {$t('notes.periodic.settings.preview')}
            </div>
            <div class="font-mono">{previewName(kind)}</div>
            {#if kind === 'weekly'}
              <div class="mt-1 text-xs text-muted-foreground">
                {$t('notes.periodic.weekly.preview.range_hint', {
                  values: { range: previewRange('weekly') }
                })}
              </div>
            {/if}
          </div>
        </CardContent>
      </Card>
    {/each}
  </div>
</SettingsLayout>
