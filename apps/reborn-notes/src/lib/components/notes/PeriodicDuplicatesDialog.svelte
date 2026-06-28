<!--
  @component
  Confirmation modal offering to merge duplicate periodic notes. Opens when
  `detectAndNotifyPeriodicDuplicates` (fire-and-forget after a pull) posts to the
  `periodicDuplicatePrompt` store. Replaces the old auto-dismissing toast, which
  vanished before the user could act on a semi-destructive merge (smoke #2 of
  PR #356). Mounted once, globally, in +layout.svelte.
-->
<script lang="ts">
  import ConfirmDialog from '../shared/ConfirmDialog.svelte';
  import {
    periodicDuplicatePrompt,
    confirmMergePeriodicDuplicates,
    dismissPeriodicDuplicatePrompt
  } from '$lib/services/periodic-dedup.service';
  import { t } from '$lib/stores/i18n.store';

  let open = $state(false);
  // Latched so the close animation keeps its text after the store clears.
  let count = $state(0);

  // `open` is a pure function of the store: opens on a posted prompt, closes when
  // cleared (by confirm/dismiss).
  $effect(() => {
    const p = $periodicDuplicatePrompt;
    if (p) count = p.extra;
    open = p !== null;
  });

  // Closed via Escape / overlay click bypasses the action callbacks; treat that
  // as a dismiss so `open` and the store stay consistent. notifiedKeys already
  // guards against re-popping the same batch this session.
  $effect(() => {
    if (!open && $periodicDuplicatePrompt !== null) {
      dismissPeriodicDuplicatePrompt();
    }
  });
</script>

<ConfirmDialog
  bind:open
  title={$t('notes.periodic.dedup.modal_title')}
  description={$t('notes.periodic.dedup.modal_description', { values: { count } })}
  confirmText={$t('notes.periodic.dedup.merge_action')}
  cancelText={$t('notes.periodic.dedup.dismiss_action')}
  onConfirm={confirmMergePeriodicDuplicates}
  onCancel={dismissPeriodicDuplicatePrompt}
/>
