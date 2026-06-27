<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsLayout,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
  } from '@reborn/ui';
  import { KeyRound, FolderOpen, AlertTriangle, Copy, Check, ShieldCheck } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { IS_NATIVE } from '$lib/utils/native-client';
  import { generateRecoveryPhrase } from '@reborn/crypto';
  import type { AutoBackupState } from '@reborn/backup';
  import {
    runNotesAutoBackupIfDue,
    loadAutoBackupConfig,
    saveAutoBackupConfig,
    loadAutoBackupState,
    DEFAULT_NOTES_AUTO_BACKUP_CONFIG,
    type NotesAutoBackupConfig
  } from '$lib/services/auto-backup';

  const supported = IS_NATIVE;

  let cfg = $state<NotesAutoBackupConfig>({ ...DEFAULT_NOTES_AUTO_BACKUP_CONFIG });
  let bstate = $state<AutoBackupState>({ lastBackupAt: null, lastError: null });
  let phraseSet = $state(false);

  // The 12 words currently on screen (after generate, or while viewing). null = hidden.
  let shownPhrase = $state<string | null>(null);
  // true right after generation (needs the "I saved it" confirmation before it
  // is written to the vault); false when merely re-viewing an existing phrase.
  let phraseIsNew = $state(false);
  let confirmChecked = $state(false);
  let copied = $state(false);

  let busyNow = $state(false);
  let nowResult = $state<'done' | 'nothing' | 'error' | null>(null);
  let nowError = $state('');

  const canEnable = $derived(phraseSet && !!cfg.folderBookmark);
  const words = $derived(shownPhrase ? shownPhrase.split(' ') : []);

  onMount(async () => {
    if (!supported) return;
    cfg = loadAutoBackupConfig();
    bstate = loadAutoBackupState();
    const { loadRecoveryPhrase } = await import('$lib/services/auto-backup/recovery-phrase-vault');
    phraseSet = Boolean(await loadRecoveryPhrase());
  });

  function generate() {
    shownPhrase = generateRecoveryPhrase();
    phraseIsNew = true;
    confirmChecked = false;
    copied = false;
  }

  async function copyPhrase() {
    if (!shownPhrase) return;
    try {
      await navigator.clipboard.writeText(shownPhrase);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard can be unavailable; the words are on screen to copy by hand.
    }
  }

  async function confirmSaved() {
    if (!shownPhrase || !confirmChecked) return;
    const { saveRecoveryPhrase } = await import('$lib/services/auto-backup/recovery-phrase-vault');
    await saveRecoveryPhrase(shownPhrase);
    phraseSet = true;
    shownPhrase = null;
    phraseIsNew = false;
    confirmChecked = false;
  }

  async function viewPhrase() {
    const { loadRecoveryPhrase } = await import('$lib/services/auto-backup/recovery-phrase-vault');
    shownPhrase = await loadRecoveryPhrase();
    phraseIsNew = false;
  }

  function hidePhrase() {
    shownPhrase = null;
  }

  async function pickFolder() {
    const { getFolderFs } = await import('$lib/utils/native-folder-fs');
    const res = await getFolderFs().pickDirectory();
    if (res.cancelled || !res.bookmark) return;
    cfg.folderBookmark = res.bookmark;
    cfg.folderName = res.name ?? '';
    saveAutoBackupConfig(cfg);
  }

  function toggleEnabled() {
    if (!cfg.enabled && !canEnable) return;
    cfg.enabled = !cfg.enabled;
    saveAutoBackupConfig(cfg);
  }

  async function backupNow() {
    busyNow = true;
    nowResult = null;
    try {
      const out = await runNotesAutoBackupIfDue({ force: true });
      bstate = loadAutoBackupState();
      if (out.status === 'backed-up') nowResult = 'done';
      else if (out.status === 'error') {
        nowResult = 'error';
        nowError = out.error;
      } else nowResult = 'nothing';
    } finally {
      busyNow = false;
    }
  }
</script>

<svelte:head>
  <title>{$t('settings_page.backup.title')} - re/notes</title>
</svelte:head>

<SettingsLayout title={$t('settings_page.backup.title')} backHref="/settings">
  <div class="space-y-6 px-4 sm:px-0">
    <Card>
      <CardHeader>
        <CardTitle class="text-base">{$t('settings_page.backup.title')}</CardTitle>
        <CardDescription>{$t('settings_page.backup.desc')}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        {#if !supported}
          <p class="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            {$t('settings_page.backup.native_only')}
          </p>
        {:else}
          <!-- Recovery phrase -->
          <section class="space-y-3">
            <div class="flex items-center gap-2">
              <KeyRound class="h-4 w-4 text-muted-foreground" />
              <h3 class="text-sm font-medium">{$t('settings_page.backup.phrase_heading')}</h3>
            </div>
            <p class="text-xs text-muted-foreground">{$t('settings_page.backup.phrase_intro')}</p>

            {#if shownPhrase}
              <div class="space-y-3 rounded-lg border border-primary/40 bg-muted/30 p-4">
                {#if phraseIsNew}
                  <div class="flex items-start gap-2">
                    <AlertTriangle
                      class="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
                    />
                    <p class="text-xs text-amber-700 dark:text-amber-400">
                      {$t('settings_page.backup.phrase_warning')}
                    </p>
                  </div>
                {/if}
                <ol class="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  {#each words as word, i (i)}
                    <li class="flex items-baseline gap-2 font-mono text-sm">
                      <span class="w-5 shrink-0 text-right text-xs text-muted-foreground/60"
                        >{i + 1}</span
                      >
                      <span>{word}</span>
                    </li>
                  {/each}
                </ol>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onclick={copyPhrase}
                    class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                  >
                    {#if copied}
                      <Check class="h-3.5 w-3.5" />
                      {$t('settings_page.backup.phrase_copied')}
                    {:else}
                      <Copy class="h-3.5 w-3.5" />
                      {$t('settings_page.backup.phrase_copy_btn')}
                    {/if}
                  </button>
                  {#if !phraseIsNew}
                    <button
                      type="button"
                      onclick={hidePhrase}
                      class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                    >
                      {$t('settings_page.backup.phrase_hide_btn')}
                    </button>
                  {/if}
                </div>
                {#if phraseIsNew}
                  <label class="flex items-start gap-2 text-xs cursor-pointer">
                    <input type="checkbox" bind:checked={confirmChecked} class="mt-0.5" />
                    <span>{$t('settings_page.backup.phrase_confirm_label')}</span>
                  </label>
                  <button
                    type="button"
                    onclick={confirmSaved}
                    disabled={!confirmChecked}
                    class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {$t('settings_page.backup.phrase_confirm_btn')}
                  </button>
                {/if}
              </div>
            {:else if phraseSet}
              <div class="flex flex-wrap items-center gap-3">
                <span class="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ShieldCheck class="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  {$t('settings_page.backup.phrase_set')}
                </span>
                <button
                  type="button"
                  onclick={viewPhrase}
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                >
                  {$t('settings_page.backup.phrase_view_btn')}
                </button>
              </div>
            {:else}
              <button
                type="button"
                onclick={generate}
                class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                <KeyRound class="h-3.5 w-3.5" />
                {$t('settings_page.backup.phrase_generate_btn')}
              </button>
            {/if}
          </section>

          <!-- Backup folder -->
          <section class="space-y-3 border-t pt-5">
            <div class="flex items-center gap-2">
              <FolderOpen class="h-4 w-4 text-muted-foreground" />
              <h3 class="text-sm font-medium">{$t('settings_page.backup.folder_heading')}</h3>
            </div>
            <p class="text-xs text-muted-foreground">{$t('settings_page.backup.folder_intro')}</p>
            {#if cfg.folderName}
              <div class="flex flex-wrap items-center gap-3">
                <span class="text-sm">
                  {$t('settings_page.backup.folder_current', { values: { name: cfg.folderName } })}
                </span>
                <button
                  type="button"
                  onclick={pickFolder}
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                >
                  {$t('settings_page.backup.folder_change_btn')}
                </button>
              </div>
            {:else}
              <button
                type="button"
                onclick={pickFolder}
                class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                <FolderOpen class="h-3.5 w-3.5" />
                {$t('settings_page.backup.folder_pick_btn')}
              </button>
            {/if}
          </section>

          <!-- Enable -->
          <section class="space-y-2 border-t pt-5">
            <label class="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.enabled}
                disabled={!cfg.enabled && !canEnable}
                onchange={toggleEnabled}
                class="mt-0.5"
              />
              <span>
                <span class="font-medium">{$t('settings_page.backup.enable_label')}</span>
                <span class="block text-xs text-muted-foreground">
                  {$t('settings_page.backup.enable_desc')}
                </span>
              </span>
            </label>
            {#if !canEnable}
              <p class="text-xs text-muted-foreground/80 pl-6">
                {$t('settings_page.backup.enable_requires')}
              </p>
            {/if}
          </section>

          <!-- Status -->
          {#if cfg.enabled}
            <section class="space-y-2 border-t pt-5">
              <h3 class="text-sm font-medium">{$t('settings_page.backup.status_heading')}</h3>
              {#if bstate.lastBackupAt}
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.backup.status_last', {
                    values: { time: new Date(bstate.lastBackupAt).toLocaleString() }
                  })}
                </p>
              {:else}
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.backup.status_never')}
                </p>
              {/if}
              {#if bstate.lastError}
                <p class="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {$t('settings_page.backup.status_error', { values: { error: bstate.lastError } })}
                </p>
              {/if}
              <div class="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onclick={backupNow}
                  disabled={busyNow}
                  class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {busyNow
                    ? $t('settings_page.backup.now_running')
                    : $t('settings_page.backup.now_btn')}
                </button>
                {#if nowResult === 'done'}
                  <span class="text-xs text-emerald-600 dark:text-emerald-400">
                    {$t('settings_page.backup.now_done')}
                  </span>
                {:else if nowResult === 'nothing'}
                  <span class="text-xs text-muted-foreground">
                    {$t('settings_page.backup.now_nothing')}
                  </span>
                {:else if nowResult === 'error'}
                  <span class="text-xs text-destructive">
                    {$t('settings_page.backup.now_failed', { values: { error: nowError } })}
                  </span>
                {/if}
              </div>
              <p class="text-[11px] text-muted-foreground/70 pt-1">
                {$t('settings_page.backup.cadence_note')}
              </p>
            </section>
          {/if}
        {/if}
      </CardContent>
    </Card>
  </div>
</SettingsLayout>
