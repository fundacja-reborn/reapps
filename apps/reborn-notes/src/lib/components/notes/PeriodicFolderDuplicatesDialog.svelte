<!--
  @component
  Confirmation modal offering to consolidate duplicate periodic FOLDERS (the
  2026-06-28 sync-race left some accounts with a dozen "Daily Notes" folders).
  Opens when `detectAndNotifyPeriodicFolderDuplicates` (fire-and-forget after a
  pull) posts to the `periodicFolderDuplicatePrompt` store. On confirm it moves
  every note into one folder per kind, merges same-period copies, and removes the
  empty duplicate folders. Mounted once, globally, in +layout.svelte.
-->
<script lang="ts">
  import ConfirmDialog from '../shared/ConfirmDialog.svelte';
  import {
    periodicFolderDuplicatePrompt,
    confirmMergePeriodicFolderDuplicates,
    dismissPeriodicFolderDuplicatePrompt
  } from '$lib/services/periodic-folder-dedup.service';
  import { t } from '$lib/stores/i18n.store';

  let open = $state(false);
  // Latched so the close animation keeps its text after the store clears.
  let folders = $state(0);

  // `open` is a pure function of the store: opens on a posted prompt, closes when
  // cleared (by confirm/dismiss).
  $effect(() => {
    const p = $periodicFolderDuplicatePrompt;
    if (p) folders = p.folders;
    open = p !== null;
  });

  // Closed via Escape / overlay click bypasses the action callbacks; treat that
  // as a dismiss so `open` and the store stay consistent. notifiedFolderKeys
  // already guards against re-popping the same batch this session.
  $effect(() => {
    if (!open && $periodicFolderDuplicatePrompt !== null) {
      dismissPeriodicFolderDuplicatePrompt();
    }
  });
</script>

<ConfirmDialog
  bind:open
  title={$t('notes.periodic.folder_dedup.modal_title')}
  description={$t('notes.periodic.folder_dedup.modal_description', { values: { count: folders } })}
  confirmText={$t('notes.periodic.folder_dedup.merge_action')}
  cancelText={$t('notes.periodic.folder_dedup.dismiss_action')}
  onConfirm={confirmMergePeriodicFolderDuplicates}
  onCancel={dismissPeriodicFolderDuplicatePrompt}
/>
