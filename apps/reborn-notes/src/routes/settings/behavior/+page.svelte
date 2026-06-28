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
    toast
  } from '@reborn/ui';
  import { Eye, Pencil, Trash2 } from '@lucide/svelte';
  import {
    appSettings,
    confirmBeforeDelete as confirmBeforeDeleteStore,
    editorMode as editorModeStore
  } from '$lib/stores/app-settings.store';
  import type { EditorMode } from '@reborn/storage';
  import {
    devicePrefs,
    noteOpenMode as noteOpenModeStore,
    type NoteOpenMode
  } from '$lib/stores/device-prefs.store';
  import { t } from '$lib/stores/i18n.store';
  import { createLogger } from '@reborn/utils';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';

  const logger = createLogger('behavior-settings');
  const isMobile = useIsMobile();

  let openModeValue = $state<NoteOpenMode>('preview');
  let editorModeValue = $state<EditorMode>('markdown');
  let confirmDeleteValue = $state(true);

  // Split is a desktop layout (editor + preview side by side). On phones the app
  // collapses it to plain edit, so don't offer it as a choice on this device.
  const openModeOptions = $derived<readonly NoteOpenMode[]>(
    isMobile.value ? ['preview', 'edit'] : ['preview', 'edit', 'split']
  );

  function openModeLabel(mode: NoteOpenMode): string {
    return mode === 'edit'
      ? $t('settings_page.behavior.open_mode_edit')
      : mode === 'split'
        ? $t('settings_page.behavior.open_mode_split')
        : $t('settings_page.behavior.open_mode_preview');
  }

  function updateOpenMode(value: string | undefined) {
    if (value !== 'preview' && value !== 'edit' && value !== 'split') return;
    devicePrefs.setNoteOpenMode(value);
    openModeValue = value;
    toast.success($t('settings_page.behavior.open_mode_updated'));
  }

  async function updateEditorMode(value: string | undefined) {
    if (value !== 'markdown' && value !== 'live') return;
    try {
      await appSettings.update('editorMode', value);
      editorModeValue = value;
      toast.success($t('settings_page.behavior.editor_mode_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update editor mode', err);
    }
  }

  async function updateConfirmDelete(value: boolean) {
    try {
      await appSettings.update('confirmBeforeDelete', value);
      confirmDeleteValue = value;
      toast.success($t('settings_page.behavior.confirm_delete_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update delete confirmation', err);
    }
  }

  onMount(() => {
    const unsubscribes = [
      noteOpenModeStore.subscribe((v) => (openModeValue = v)),
      editorModeStore.subscribe((v) => (editorModeValue = v)),
      confirmBeforeDeleteStore.subscribe((v) => (confirmDeleteValue = v))
    ];
    return () => unsubscribes.forEach((fn) => fn());
  });
</script>

<svelte:head>
  <title>{$t('settings_page.behavior.title')} — re/notes</title>
</svelte:head>

<SettingsLayout title={$t('settings_page.behavior.title')} backHref="/settings">
  <div class="space-y-6 px-4 sm:px-0">
    <!-- Default open mode (per-device, localStorage - not synced) -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Eye class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.behavior.open_mode')}
        </CardTitle>
        <CardDescription>{$t('settings_page.behavior.open_mode_desc')}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <Select type="single" value={openModeValue} onValueChange={(value) => updateOpenMode(value)}>
          <SelectTrigger class="w-full">
            {openModeLabel(openModeValue)}
          </SelectTrigger>
          <SelectContent>
            {#each openModeOptions as mode (mode)}
              <SelectItem value={mode}>{openModeLabel(mode)}</SelectItem>
            {/each}
          </SelectContent>
        </Select>
        <p class="text-xs text-muted-foreground">
          {$t('settings_page.behavior.open_mode_device_hint')}
        </p>
      </CardContent>
    </Card>

    <!-- Editor mode (synced across devices) -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Pencil class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.behavior.editor_mode')}
        </CardTitle>
        <CardDescription>{$t('settings_page.behavior.editor_mode_desc')}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <Select
          type="single"
          value={editorModeValue}
          onValueChange={(value) => updateEditorMode(value)}
        >
          <SelectTrigger class="w-full">
            {editorModeValue === 'live'
              ? $t('settings_page.behavior.editor_mode_live')
              : $t('settings_page.behavior.editor_mode_markdown')}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="markdown"
              >{$t('settings_page.behavior.editor_mode_markdown')}</SelectItem
            >
            <SelectItem value="live">{$t('settings_page.behavior.editor_mode_live')}</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>

    <!-- Confirm before deleting (synced across devices) -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Trash2 class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.behavior.confirm_delete')}
        </CardTitle>
        <CardDescription>{$t('settings_page.behavior.confirm_delete_desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-muted-foreground">
            {confirmDeleteValue
              ? $t('settings_page.behavior.confirm_delete_on')
              : $t('settings_page.behavior.confirm_delete_off')}
          </span>
          <Switch
            checked={confirmDeleteValue}
            onCheckedChange={(v: boolean) => updateConfirmDelete(v)}
          />
        </div>
      </CardContent>
    </Card>
  </div>
</SettingsLayout>
