<!--
  @component
  The automatic backup in the notes view: shown only when it stopped working,
  with the reason and the fix right here (guideline 71, guideline 02: the
  reason is visible, not behind a hover). Nothing while backups work, so the
  sync footer stays as quiet as before.

  - a failed backup: "Choose folder again" first when the folder lost access
    or is gone (picking it again renews the access), otherwise "Back up now";
  - no recovery phrase on this device: the way to the backup settings.

  The state comes from the latest run (`$lib/services/auto-backup/attention`).
-->
<script lang="ts">
  import { AlertTriangle, FolderOpen, RefreshCw, Settings } from '@lucide/svelte';
  import { goto } from '$lib/utils/navigation';
  import { t } from '$lib/stores/i18n.store';
  import {
    backupAttention,
    backupProblemText,
    backupRunning
  } from '$lib/services/auto-backup/attention';
  import { backUpNow, pickBackupFolderAndBackUp } from '$lib/services/auto-backup';
  import { announceBackupNow } from '$lib/services/auto-backup/announce';

  const attention = $derived($backupAttention);
  // Access lost or folder gone: picking the folder again is the fix, so it
  // leads; a plain failure (disk, self-test) is retried first.
  const folderFirst = $derived(attention?.kind === 'failed' && attention.problem !== 'failed');
  const reason = $derived(
    attention?.kind === 'failed'
      ? backupProblemText(attention.problem, attention.detail, $t)
      : attention?.kind === 'no-phrase'
        ? $t('backup_attention.no_phrase')
        : ''
  );

  async function retry() {
    announceBackupNow(await backUpNow());
  }

  // The picked folder could not be used (the system gave no access to it):
  // said above the buttons, where the user just clicked (guideline 02).
  let pickFailed = $state(false);

  async function pickAgain() {
    pickFailed = false;
    let outcome: Awaited<ReturnType<typeof pickBackupFolderAndBackUp>>;
    try {
      outcome = await pickBackupFolderAndBackUp();
    } catch {
      pickFailed = true;
      return;
    }
    if (outcome) announceBackupNow(outcome);
  }
</script>

{#snippet retryButton(primary: boolean)}
  <button
    type="button"
    onclick={retry}
    disabled={$backupRunning}
    aria-busy={$backupRunning}
    class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors disabled:opacity-70
           {primary
      ? 'bg-primary font-medium text-primary-foreground hover:bg-primary/90'
      : 'border bg-background hover:bg-accent'}"
  >
    <RefreshCw class="h-3.5 w-3.5 {$backupRunning ? 'animate-spin' : ''}" aria-hidden="true" />
    {$backupRunning ? $t('settings_page.backup.now_running') : $t('settings_page.backup.now_btn')}
  </button>
{/snippet}

{#snippet folderButton(primary: boolean)}
  <button
    type="button"
    onclick={pickAgain}
    disabled={$backupRunning}
    class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors disabled:opacity-70
           {primary
      ? 'bg-primary font-medium text-primary-foreground hover:bg-primary/90'
      : 'border bg-background hover:bg-accent'}"
  >
    <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
    {$t('settings_page.backup.folder_change_btn')}
  </button>
{/snippet}

{#if attention}
  <div
    role="status"
    class="mb-2 space-y-1.5 rounded-md border border-amber-400/50 bg-amber-500/10 px-2.5 py-2 text-xs"
  >
    <p class="flex items-start gap-1.5 font-medium text-amber-700 dark:text-amber-400">
      <AlertTriangle class="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {attention.kind === 'failed'
          ? $t('backup_attention.title_failed')
          : $t('backup_attention.title_no_phrase')}
      </span>
    </p>
    <p class="ps-5 break-words text-muted-foreground">{reason}</p>
    {#if pickFailed}
      <p role="alert" class="ps-5 break-words text-destructive">
        {$t('settings_page.backup.folder_pick_failed')}
      </p>
    {/if}
    <div class="flex flex-wrap gap-1.5 ps-5">
      {#if attention.kind === 'failed'}
        {#if folderFirst}
          {@render folderButton(true)}
          {@render retryButton(false)}
        {:else}
          {@render retryButton(true)}
          {@render folderButton(false)}
        {/if}
      {:else}
        <button
          type="button"
          onclick={() => goto('/settings/backup')}
          class="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Settings class="h-3.5 w-3.5" aria-hidden="true" />
          {$t('backup_attention.open_settings_btn')}
        </button>
      {/if}
    </div>
  </div>
{/if}
