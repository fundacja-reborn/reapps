<script lang="ts">
	import ConfirmDialog from './dialogs/ConfirmDialog.svelte';
	import { goto } from '$lib/utils/navigation';
	import { t } from '$lib/stores/i18n.store';

	// Shown when an account-only action (e.g. sharing) is attempted in local-only
	// mode. Confirm routes to registration - which adopts the local master key and
	// keeps existing tasks (see register/+page.svelte upgrade path); cancel just
	// dismisses.
	let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<ConfirmDialog
	bind:open
	title={$t('local_mode.share_title')}
	description={$t('local_mode.account_required_desc')}
	confirmText={$t('local_mode.create_account')}
	cancelText={$t('common.cancel')}
	onConfirm={() => goto('/auth/register')}
/>
