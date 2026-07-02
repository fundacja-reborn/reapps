<script lang="ts">
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    LoadingSpinner,
    Progress,
    RadioGroup,
    RadioGroupItem,
    Label
  } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { foldersStore } from '$lib/stores/folders.store';
  import type {
    DeleteFolderMode,
    DeleteFolderProgress,
    DeleteFolderProgressCallback,
    FolderDeleteSummary
  } from '$lib/services/folder.service';

  let {
    open = $bindable(false),
    folderId,
    folderName,
    onConfirm
  }: {
    open: boolean;
    folderId: string | null;
    folderName: string;
    onConfirm: (
      mode: DeleteFolderMode,
      onProgress: DeleteFolderProgressCallback
    ) => void | Promise<void>;
  } = $props();

  let mode = $state<DeleteFolderMode>('detach');
  let summary = $state<FolderDeleteSummary | null>(null);
  let loadingSummary = $state(false);
  let isProcessing = $state(false);
  // Live progress of the running delete - null until the service reports the
  // first counted item (the dialog shows "Preparing…" in the meantime).
  let progress = $state<DeleteFolderProgress | null>(null);

  // Refresh summary every time the dialog is opened for a folder.
  $effect(() => {
    if (!open || !folderId) {
      summary = null;
      mode = 'detach';
      return;
    }
    loadingSummary = true;
    foldersStore
      .getDeleteSummary(folderId)
      .then((s) => {
        summary = s;
      })
      .finally(() => {
        loadingSummary = false;
      });
  });

  const confirmLabel = $derived(
    mode === 'cascade'
      ? $t('folders.delete_dialog.confirm_cascade')
      : $t('folders.delete_dialog.confirm_detach')
  );

  // Deleting a large subtree means seconds of sequential IndexedDB work - the
  // label mirrors what is happening right now (mode-specific while notes are
  // moved, then the folder records), the bar tracks the current phase.
  const progressLabel = $derived.by(() => {
    if (!progress) return $t('folders.delete_dialog.progress_preparing');
    const { phase, current, total } = progress;
    if (phase === 'folders') {
      // All records are gone once current reaches total - the remaining tail
      // (folder tree refresh) has no measurable progress of its own.
      return current >= total
        ? $t('folders.delete_dialog.progress_finishing')
        : $t('folders.delete_dialog.progress_folders', { values: { current, total } });
    }
    return mode === 'cascade'
      ? $t('folders.delete_dialog.progress_notes_cascade', { values: { current, total } })
      : $t('folders.delete_dialog.progress_notes_detach', { values: { current, total } });
  });

  const showProgressBar = $derived.by(() => {
    if (!progress || progress.total <= 1) return false;
    return !(progress.phase === 'folders' && progress.current >= progress.total);
  });

  async function handleConfirm() {
    isProcessing = true;
    progress = null;
    try {
      await onConfirm(mode, (p) => {
        progress = p;
      });
      open = false;
    } finally {
      isProcessing = false;
      progress = null;
    }
  }

  function handleCancel() {
    if (isProcessing) return;
    open = false;
  }
</script>

<Dialog bind:open>
  <DialogContent
    showCloseButton={!isProcessing}
    escapeKeydownBehavior={isProcessing ? 'ignore' : 'close'}
    interactOutsideBehavior={isProcessing ? 'ignore' : 'close'}
  >
    <DialogHeader>
      <DialogTitle>
        {$t('folders.delete_dialog.title', { values: { name: folderName } })}
      </DialogTitle>
      <DialogDescription>
        {#if loadingSummary || !summary}
          {$t('folders.delete_dialog.loading')}
        {:else if summary.noteCount === 0 && summary.subfolderCount === 0}
          {$t('folders.delete_dialog.summary_empty')}
        {:else if summary.subfolderCount === 0}
          {$t('folders.delete_dialog.summary_notes_only', {
            values: { notes: summary.noteCount }
          })}
        {:else if summary.noteCount === 0}
          {$t('folders.delete_dialog.summary_subfolders_only', {
            values: { subfolders: summary.subfolderCount }
          })}
        {:else}
          {$t('folders.delete_dialog.summary_both', {
            values: { notes: summary.noteCount, subfolders: summary.subfolderCount }
          })}
        {/if}
      </DialogDescription>
    </DialogHeader>

    {#if isProcessing}
      <div class="space-y-2 py-2" role="status" aria-live="polite">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingSpinner size="sm" />
          <span>{progressLabel}</span>
        </div>
        {#if showProgressBar && progress}
          <Progress value={progress.current} max={progress.total} class="h-1.5" />
        {/if}
      </div>
    {:else if summary && summary.noteCount > 0}
      <RadioGroup bind:value={mode} class="gap-3 py-2">
        <div class="flex items-start gap-3">
          <RadioGroupItem value="detach" id="delete-mode-detach" class="mt-1" />
          <Label for="delete-mode-detach" class="flex flex-col gap-0.5 cursor-pointer">
            <span class="font-medium">{$t('folders.delete_dialog.mode_detach_label')}</span>
            <span class="text-xs text-muted-foreground font-normal">
              {$t('folders.delete_dialog.mode_detach_hint')}
            </span>
          </Label>
        </div>
        <div class="flex items-start gap-3">
          <RadioGroupItem value="cascade" id="delete-mode-cascade" class="mt-1" />
          <Label for="delete-mode-cascade" class="flex flex-col gap-0.5 cursor-pointer">
            <span class="font-medium">{$t('folders.delete_dialog.mode_cascade_label')}</span>
            <span class="text-xs text-muted-foreground font-normal">
              {$t('folders.delete_dialog.mode_cascade_hint')}
            </span>
          </Label>
        </div>
      </RadioGroup>
    {/if}

    <DialogFooter>
      <Button variant="outline" onclick={handleCancel} disabled={isProcessing}>
        {$t('folders.delete_dialog.cancel')}
      </Button>
      <Button variant="destructive" onclick={handleConfirm} disabled={isProcessing || loadingSummary}>
        {confirmLabel}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
