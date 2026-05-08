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
    Input,
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
  import { foldersStore } from '$lib/stores/folders.store';
  import type { FolderWithChildren } from '@reborn/types';
  import { t } from '$lib/stores/i18n.store';
  import {
    formatRange,
    buildPeriodicTitle
  } from '$lib/services/periodic-notes-format';
  import { createLogger } from '@reborn/utils';

  const logger = createLogger('settings-periodic-notes');

  // Snapshot used for inputs / dropdowns; mirrors the derived store.
  let local = $state<PeriodicNotesSettings>(structuredClone(PERIODIC_NOTES_DEFAULTS));

  // For format pickers we need to know whether the current format matches
  // a preset (so the dropdown shows it) or it's a custom string (so we show
  // the "Custom…" entry and a free-text input below).
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

  // Flatten the folder tree to a list of `{id, label}` so the picker shows
  // nesting via indented labels — same trick MoveToFolderMenu uses.
  function flattenFolders(
    nodes: FolderWithChildren[],
    depth = 0,
    out: Array<{ id: string; label: string }> = []
  ): Array<{ id: string; label: string }> {
    for (const n of nodes) {
      out.push({ id: n.id, label: `${'  '.repeat(depth)}${n.name}` });
      if (n.children?.length) flattenFolders(n.children, depth + 1, out);
    }
    return out;
  }

  const folderOptions = $derived(flattenFolders($foldersStore));

  function folderLabelById(id: string | null): string {
    if (!id) return $t('notes.periodic.settings.folder_root');
    const match = folderOptions.find((o) => o.id === id);
    return match?.label.trim() || $t('notes.periodic.settings.folder_root');
  }

  function isCustomFormat(kind: PeriodicKind, format: string): boolean {
    return !PRESETS[kind].includes(format);
  }

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
            <Select
              type="single"
              value={local[kind].folderId ?? ''}
              onValueChange={(value) =>
                patchKind(kind, { folderId: value && value !== '' ? value : null })
              }
            >
              <SelectTrigger id="folder-{kind}" class="w-full">
                {folderLabelById(local[kind].folderId)}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{$t('notes.periodic.settings.folder_root')}</SelectItem>
                {#each folderOptions as opt (opt.id)}
                  <SelectItem value={opt.id}>{opt.label}</SelectItem>
                {/each}
              </SelectContent>
            </Select>
          </div>

          <!-- Format preset dropdown -->
          <div class="space-y-1.5">
            <label for="format-{kind}" class="text-sm font-medium">
              {$t('notes.periodic.settings.format')}
            </label>
            <Select
              type="single"
              value={isCustomFormat(kind, local[kind].format) ? '__custom__' : local[kind].format}
              onValueChange={(value) => {
                if (value === '__custom__') {
                  // Switching to custom — keep current format but allow free editing.
                  return;
                }
                if (value) patchKind(kind, { format: value });
              }}
            >
              <SelectTrigger id="format-{kind}" class="w-full">
                {isCustomFormat(kind, local[kind].format)
                  ? $t('notes.periodic.settings.format_custom')
                  : local[kind].format}
              </SelectTrigger>
              <SelectContent>
                {#each PRESETS[kind] as preset (preset)}
                  <SelectItem value={preset}>{preset}</SelectItem>
                {/each}
                <SelectItem value="__custom__">
                  {$t('notes.periodic.settings.format_custom')}
                </SelectItem>
              </SelectContent>
            </Select>

            {#if isCustomFormat(kind, local[kind].format)}
              <Input
                aria-label={$t('notes.periodic.settings.format_custom_label')}
                value={local[kind].format}
                oninput={(e) => {
                  const target = e.currentTarget as HTMLInputElement;
                  patchKind(kind, { format: target.value });
                }}
              />
            {/if}
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
