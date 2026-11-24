<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    SettingsLayout,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
  } from '@reborn/ui';
  import {
    KeyRound,
    FolderOpen,
    AlertTriangle,
    Copy,
    Check,
    ShieldCheck,
    BellOff,
    Bell,
    Settings
  } from '@lucide/svelte';
  import type { ReminderPermission } from '$lib/services/auto-backup/reminder';
  import { t, locale } from '$lib/stores/i18n.store';
  import { isolateInDirection, isolateLeftToRight, textDirection } from '@reborn/i18n';
  import { dateFormat, timeFormat } from '$lib/stores/app-settings.store';
  import { formatSettingsDateTime } from '$lib/utils/date-format';
  import { localOnly } from '$lib/stores/sync-status.store';
  import { IS_NATIVE } from '$lib/utils/native-client';
  import { copyText } from '$lib/utils/clipboard';
  import { generateRecoveryPhrase } from '@reborn/crypto';
  import type { AutoBackupState } from '@reborn/backup';
  import {
    backUpNow,
    loadAutoBackupConfig,
    saveAutoBackupConfig,
    loadAutoBackupState,
    DEFAULT_NOTES_AUTO_BACKUP_CONFIG,
    type NotesAutoBackupConfig
  } from '$lib/services/auto-backup';
  import {
    hasPhraseChangedNotice,
    clearPhraseChangedNotice
  } from '$lib/services/auto-backup/prefs';
  import {
    attentionFromState,
    backupProblem,
    backupProblemText,
    backupRunning,
    showBackupAttention
  } from '$lib/services/auto-backup/attention';

  const supported = IS_NATIVE;

  let cfg = $state<NotesAutoBackupConfig>({ ...DEFAULT_NOTES_AUTO_BACKUP_CONFIG });
  let bstate = $state<AutoBackupState>({ lastBackupAt: null, lastError: null });
  let phraseSet = $state(false);
  // The vault phrase was replaced from the account (rotation on another
  // device) - the user must re-view it so their written kit stays current.
  let phraseChanged = $state(false);

  // The 12 words currently on screen (after generate, or while viewing). null = hidden.
  let shownPhrase = $state<string | null>(null);
  // true right after generation (needs the "I saved it" confirmation before it
  // is written to the vault); false when merely re-viewing an existing phrase.
  let phraseIsNew = $state(false);
  let confirmChecked = $state(false);
  let copied = $state(false);

  // What settings say about the overdue reminder: the promise only where one
  // can come; with notifications turned off in the system, that instead. A
  // desktop shell without a notification center (dev binary) says nothing.
  // `unsupported` until the system answers, so neither the promise nor the
  // "turn on" button flashes before it is known.
  let reminderPermission = $state<ReminderPermission>('unsupported');
  // Notifications turned off: macOS and iOS can open the system page where
  // they are turned back on; Android only gets the text.
  let canOpenSystemSettings = $state(false);
  // "Turn on notifications" was clicked and the permission is still undecided:
  // the system did not ask (macOS refuses a build without a valid signature
  // silently) or the question was dismissed. The click must still answer.
  let reminderStillOff = $state(false);

  async function refreshReminderPermission() {
    const { getBackupReminderPermission } = await import('$lib/services/auto-backup/reminder');
    reminderPermission = await getBackupReminderPermission();
  }

  /**
   * Backup already on, but the system never asked about notifications (a new
   * install or build, or a device where it was turned on before the prompt
   * existed): ask now, on the user's click, instead of promising a reminder
   * that cannot come.
   */
  async function allowReminders() {
    const { ensureReminderPermission, syncBackupReminders } =
      await import('$lib/services/auto-backup/reminder');
    await ensureReminderPermission();
    await syncBackupReminders();
    await refreshReminderPermission();
    reminderStillOff = reminderPermission === 'prompt';
  }

  async function openSystemNotificationSettings() {
    const { openNotificationSettings } = await import('$lib/services/auto-backup/reminder');
    await openNotificationSettings();
  }

  let nowResult = $state<'done' | 'nothing' | 'error' | null>(null);
  let nowError = $state('');

  // The last failure as the user is told it: an explanation for a lost or
  // missing folder, the raw reason otherwise.
  const statusError = $derived(
    bstate.lastError
      ? backupProblemText(backupProblem(bstate.lastErrorCode), bstate.lastError, $t)
      : ''
  );

  const canEnable = $derived(phraseSet && !!cfg.folderBookmark);
  const words = $derived(shownPhrase ? shownPhrase.split(' ') : []);

  // The toggle stays clickable even before steps 1 and 2 are done: a disabled
  // checkbox ignored clicks without a word, which read as a bug. A click with a
  // step missing leaves it off and shows, right under it, which steps are left,
  // with their buttons, and focus moves to the first one (guideline 02: react
  // where the user clicked).
  let enableAttempted = $state(false);
  let phraseSection = $state<HTMLElement | null>(null);
  let confirmCheckbox = $state<HTMLInputElement | null>(null);
  let missingPhraseButton = $state<HTMLButtonElement | null>(null);
  let missingFolderButton = $state<HTMLButtonElement | null>(null);

  // Where the backup folder is now ("~/Documents/Backups"): the desktop shell
  // knows the path and follows a folder renamed or moved since it was picked.
  // The phones give the name only, so there the name picked is shown. Read
  // live, never stored.
  let folderLocation = $state<string | null>(null);
  const folderShown = $derived(
    folderLocation ? isolateLeftToRight(folderLocation, $textDirection) : cfg.folderName
  );

  async function refreshFolderLocation() {
    const bookmark = cfg.folderBookmark;
    if (!__REBORN_DESKTOP__ || !bookmark) {
      folderLocation = null;
      return;
    }
    const { getFolderFs } = await import('$lib/utils/native-folder-fs');
    try {
      folderLocation = (await getFolderFs().describeDirectory?.({ bookmark }))?.path ?? null;
    } catch {
      // Folder gone or unreachable: the name stays, the backup status says why.
      folderLocation = null;
    }
  }

  onMount(async () => {
    if (!supported) return;
    cfg = loadAutoBackupConfig();
    bstate = loadAutoBackupState();
    void refreshFolderLocation();
    // Hydrate the vault from the account-scoped wrapped copy first, so a
    // phrase enabled on another device (or before a logout) shows up as set
    // here instead of prompting for a brand-new one. Never throws.
    const { reconcileRecoveryPhrase } = await import('$lib/services/auto-backup/phrase-sync');
    await reconcileRecoveryPhrase();
    const { loadRecoveryPhrase } = await import('$lib/services/auto-backup/recovery-phrase-vault');
    phraseSet = Boolean(await loadRecoveryPhrase());
    phraseChanged = hasPhraseChangedNotice();
    await refreshReminderPermission();
    const { canOpenNotificationSettings } = await import('$lib/services/auto-backup/reminder');
    canOpenSystemSettings = await canOpenNotificationSettings();
  });

  // Coming back from the system settings (notifications turned on or off
  // there) updates the text: a window focus on desktop, a visibility change
  // on the phones. Coming back from Finder (folder renamed or moved) updates
  // the folder's path.
  $effect(() => {
    if (!supported) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshReminderPermission();
      void refreshFolderLocation();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  });

  function generate() {
    shownPhrase = generateRecoveryPhrase();
    phraseIsNew = true;
    confirmChecked = false;
    copied = false;
  }

  async function copyPhrase() {
    if (!shownPhrase) return;
    // Route through the shared helper: the raw Clipboard API / execCommand both
    // no-op (without throwing) inside the Android WebView, so this uses the
    // native @capacitor/clipboard plugin on device. The words stay on screen as
    // a manual fallback if even that fails.
    const ok = await copyText(shownPhrase);
    if (!ok) return;
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  async function confirmSaved() {
    if (!shownPhrase || !confirmChecked) return;
    // Writes the OS vault AND publishes the wrapped copy to synced settings,
    // making the phrase account-scoped (survives logout, reaches other devices).
    const { storeRecoveryPhrase } = await import('$lib/services/auto-backup/phrase-sync');
    await storeRecoveryPhrase(shownPhrase);
    phraseSet = true;
    shownPhrase = null;
    phraseIsNew = false;
    confirmChecked = false;
  }

  async function viewPhrase() {
    const { loadRecoveryPhrase } = await import('$lib/services/auto-backup/recovery-phrase-vault');
    shownPhrase = await loadRecoveryPhrase();
    phraseIsNew = false;
    // Viewing the current phrase resolves the "changed on another device"
    // notice - the user can now bring their written kit up to date.
    if (phraseChanged) {
      clearPhraseChangedNotice();
      phraseChanged = false;
    }
  }

  function hidePhrase() {
    shownPhrase = null;
  }

  // The system gave the app no access to the folder the user picked (on a Mac,
  // security software can block Documents and Desktop; smoke test 2026-11-24).
  // Said under the folder buttons instead of failing silently (guideline 02).
  let folderPickFailed = $state(false);

  async function pickFolder() {
    const { getFolderFs } = await import('$lib/utils/native-folder-fs');
    folderPickFailed = false;
    let res: Awaited<ReturnType<ReturnType<typeof getFolderFs>['pickDirectory']>>;
    try {
      // Backups need a writable grant; sync picks elsewhere stay read-only.
      res = await getFolderFs().pickDirectory({ write: true });
    } catch {
      folderPickFailed = true;
      return;
    }
    if (res.cancelled || !res.bookmark) return;
    cfg.folderBookmark = res.bookmark;
    cfg.folderName = res.name ?? '';
    saveAutoBackupConfig(cfg);
    void refreshFolderLocation();
    // The last backup failed (no access, folder gone): try the new pick right
    // away, so the status below says whether it works now.
    if (cfg.enabled && bstate.lastError) await backupNow();
  }

  async function onToggleChange(e: Event & { currentTarget: HTMLInputElement }) {
    if (!cfg.enabled && !canEnable) {
      e.currentTarget.checked = false;
      enableAttempted = true;
      await tick();
      (missingPhraseButton ?? missingFolderButton)?.focus();
      return;
    }
    await toggleEnabled();
  }

  /** "Recovery phrase" in the missing-steps list: start or finish step 1. */
  async function finishPhraseStep() {
    if (!shownPhrase) generate();
    await tick();
    phraseSection?.scrollIntoView({ block: 'start' });
    confirmCheckbox?.focus({ preventScroll: true });
  }

  async function toggleEnabled() {
    if (!cfg.enabled && !canEnable) return;
    cfg.enabled = !cfg.enabled;
    saveAutoBackupConfig(cfg);
    // Overdue reminders follow the toggle. Enabling is the one moment the OS
    // notification prompt has obvious context; a denial only mutes reminders,
    // the backups themselves are unaffected.
    const { ensureReminderPermission, syncBackupReminders } =
      await import('$lib/services/auto-backup/reminder');
    if (cfg.enabled) await ensureReminderPermission();
    await syncBackupReminders();
    await refreshReminderPermission();
    // The notice in the notes view follows the switch (off hides it).
    showBackupAttention(attentionFromState(cfg.enabled, loadAutoBackupState()));
  }

  async function backupNow() {
    nowResult = null;
    // Shared with the notes view and the desktop menu: one run at a time.
    const out = await backUpNow();
    bstate = loadAutoBackupState();
    if (out.status === 'backed-up') nowResult = 'done';
    else if (out.status === 'error') {
      nowResult = 'error';
      nowError = backupProblemText(backupProblem(out.code), out.error, $t);
    } else nowResult = 'nothing';
  }
</script>

<svelte:head>
  <title>{$t('settings_page.backup.title')} - re/notes</title>
</svelte:head>

{#snippet stepBadge(n: number, done: boolean)}
  {#if done}
    <span
      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    >
      <Check class="h-3.5 w-3.5" aria-hidden="true" />
      <span class="sr-only">{$t('settings_page.backup.step_done')}</span>
    </span>
  {:else}
    <span
      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-medium text-muted-foreground"
      >{n}</span
    >
  {/if}
{/snippet}

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
          <section class="space-y-3 scroll-mt-4" bind:this={phraseSection}>
            <div class="flex items-center gap-2">
              {@render stepBadge(1, phraseSet)}
              <h3 class="text-sm font-medium">{$t('settings_page.backup.phrase_heading')}</h3>
            </div>
            <p class="text-xs text-muted-foreground">{$t('settings_page.backup.phrase_intro')}</p>

            {#if phraseChanged}
              <div
                class="flex items-start gap-2 rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2.5"
              >
                <AlertTriangle class="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <p class="text-xs text-amber-700 dark:text-amber-400">
                  {$t('settings_page.backup.phrase_updated_notice')}
                </p>
              </div>
            {/if}

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
                      <span class="w-5 shrink-0 text-end text-xs text-muted-foreground/60"
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
                    <input
                      type="checkbox"
                      bind:checked={confirmChecked}
                      bind:this={confirmCheckbox}
                      class="mt-0.5"
                    />
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
              {#if !$localOnly}
                <p class="text-xs text-muted-foreground/80">
                  {$t('settings_page.backup.phrase_synced_hint')}
                </p>
              {/if}
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
              {@render stepBadge(2, !!cfg.folderBookmark)}
              <h3 class="text-sm font-medium">{$t('settings_page.backup.folder_heading')}</h3>
            </div>
            <p class="text-xs text-muted-foreground">{$t('settings_page.backup.folder_intro')}</p>
            {#if cfg.folderName}
              <div class="flex flex-wrap items-center gap-3">
                <!-- A path wraps rather than losing its end (the folder's own name). -->
                <span class="min-w-0 text-sm [overflow-wrap:anywhere]">
                  {$t('settings_page.backup.folder_current', { values: { name: folderShown } })}
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
            {#if folderPickFailed}
              <p role="alert" class="flex items-start gap-2 text-xs text-destructive">
                <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{$t('settings_page.backup.folder_pick_failed')}</span>
              </p>
            {/if}
          </section>

          <!-- Enable -->
          <section class="flex items-start gap-2 border-t pt-5">
            {@render stepBadge(3, cfg.enabled)}
            <div class="min-w-0 flex-1 space-y-2">
              <label class="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  onchange={onToggleChange}
                  aria-describedby={!canEnable ? 'auto-backup-requires' : undefined}
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
                {#if enableAttempted}
                  <div
                    id="auto-backup-requires"
                    role="alert"
                    class="ms-6 space-y-2 rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2.5"
                  >
                    <p class="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle class="h-4 w-4 shrink-0" />
                      {$t('settings_page.backup.enable_missing_title')}
                    </p>
                    <ul class="space-y-2">
                      {#if !phraseSet}
                        <li class="flex flex-wrap items-center gap-2 text-xs">
                          {@render stepBadge(1, false)}
                          <span class="font-medium"
                            >{$t('settings_page.backup.phrase_heading')}</span
                          >
                          <button
                            type="button"
                            bind:this={missingPhraseButton}
                            onclick={finishPhraseStep}
                            class="flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                          >
                            <KeyRound class="h-3.5 w-3.5" />
                            {shownPhrase
                              ? $t('settings_page.backup.enable_missing_phrase_finish')
                              : $t('settings_page.backup.phrase_generate_btn')}
                          </button>
                        </li>
                      {/if}
                      {#if !cfg.folderBookmark}
                        <li class="flex flex-wrap items-center gap-2 text-xs">
                          {@render stepBadge(2, false)}
                          <span class="font-medium"
                            >{$t('settings_page.backup.folder_heading')}</span
                          >
                          <button
                            type="button"
                            bind:this={missingFolderButton}
                            onclick={pickFolder}
                            class="flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                          >
                            <FolderOpen class="h-3.5 w-3.5" />
                            {$t('settings_page.backup.folder_pick_btn')}
                          </button>
                        </li>
                      {/if}
                    </ul>
                  </div>
                {:else}
                  <p id="auto-backup-requires" class="text-xs text-muted-foreground/80 ps-6">
                    {$t('settings_page.backup.enable_requires')}
                  </p>
                {/if}
              {/if}
              {#if cfg.enabled && reminderPermission === 'denied'}
                <div class="space-y-2 ps-6">
                  <p class="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <BellOff class="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{$t('settings_page.backup.reminder_denied')}</span>
                  </p>
                  {#if canOpenSystemSettings}
                    <button
                      type="button"
                      onclick={openSystemNotificationSettings}
                      class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                    >
                      <Settings class="h-3.5 w-3.5" aria-hidden="true" />
                      {$t('settings_page.backup.reminder_open_settings_btn')}
                    </button>
                  {/if}
                </div>
              {:else if cfg.enabled && reminderPermission === 'prompt'}
                <div class="space-y-2 ps-6">
                  <p class="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Bell class="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{$t('settings_page.backup.reminder_prompt')}</span>
                  </p>
                  {#if reminderStillOff}
                    <p role="status" class="text-xs text-amber-700 dark:text-amber-400">
                      {$t('settings_page.backup.reminder_still_off')}
                    </p>
                  {/if}
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onclick={allowReminders}
                      class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                    >
                      <Bell class="h-3.5 w-3.5" aria-hidden="true" />
                      {$t('settings_page.backup.reminder_allow_btn')}
                    </button>
                    {#if reminderStillOff && canOpenSystemSettings}
                      <button
                        type="button"
                        onclick={openSystemNotificationSettings}
                        class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                      >
                        <Settings class="h-3.5 w-3.5" aria-hidden="true" />
                        {$t('settings_page.backup.reminder_open_settings_btn')}
                      </button>
                    {/if}
                  </div>
                </div>
              {:else if cfg.enabled && reminderPermission === 'granted'}
                <p class="text-xs text-muted-foreground/80 ps-6">
                  {$t('settings_page.backup.reminder_hint')}
                </p>
              {/if}
            </div>
          </section>

          <!-- Status -->
          {#if cfg.enabled}
            <section class="space-y-2 border-t pt-5">
              <h3 class="text-sm font-medium">{$t('settings_page.backup.status_heading')}</h3>
              {#if bstate.lastBackupAt}
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.backup.status_last', {
                    values: {
                      time: isolateInDirection(
                        formatSettingsDateTime(
                          bstate.lastBackupAt,
                          $dateFormat,
                          $timeFormat,
                          $locale
                        ),
                        $textDirection
                      )
                    }
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
                  {$t('settings_page.backup.status_error', { values: { error: statusError } })}
                </p>
              {/if}
              <div class="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onclick={backupNow}
                  disabled={$backupRunning}
                  aria-busy={$backupRunning}
                  class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {$backupRunning
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
              <p class="text-[0.6875rem] text-muted-foreground/70 pt-1">
                {$t('settings_page.backup.cadence_note')}
              </p>
            </section>
          {/if}
        {/if}
      </CardContent>
    </Card>
  </div>
</SettingsLayout>
