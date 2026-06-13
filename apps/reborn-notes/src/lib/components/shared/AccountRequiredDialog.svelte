<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte';
  import { goto } from '$lib/utils/navigation';
  import { t } from '$lib/stores/i18n.store';

  // Shown when an account-only action (e.g. sharing) is attempted in local-only
  // mode. Confirm routes to registration - which adopts the local master key and
  // keeps existing notes (see register/+page.svelte upgrade path); cancel just
  // dismisses. Reuses the create-account copy so the wording stays in one place.
  let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<ConfirmDialog
  bind:open
  title={$t('local_mode.share_title')}
  description={$t('settings_page.account.create_desc')}
  confirmText={$t('settings_page.account.create')}
  cancelText={$t('common.cancel')}
  onConfirm={() => goto('/auth/register')}
/>
