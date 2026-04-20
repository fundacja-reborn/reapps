<!--
  @component
  Non-dismissible banner shown when the user's session has expired.
  Displays at the top of the page and opens a re-auth modal on click.
  Does NOT trigger logout — preserves master key in RAM (offline-first).
-->
<script lang="ts">
  import { AlertTriangle } from '@lucide/svelte';
  import { t } from '@reborn/i18n';
  import ReAuthModal from './ReAuthModal.svelte';

  let {
    username = '',
    visible = false,
    onReAuth
  } = $props<{
    username?: string;
    visible?: boolean;
    onReAuth?: (password: string) => Promise<boolean>;
  }>();

  let modalOpen = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);

  function handleBannerClick() {
    error = null;
    modalOpen = true;
  }

  async function handleSubmit(password: string) {
    loading = true;
    error = null;

    try {
      const success = await onReAuth?.(password);
      if (success) {
        modalOpen = false;
      } else {
        error = $t('auth.session.error_auth_failed');
      }
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : $t('auth.session.error_unknown');
    } finally {
      loading = false;
    }
  }
</script>

{#if visible}
  <div class="sticky top-0 z-50">
    <button
      type="button"
      onclick={handleBannerClick}
      class="flex w-full items-center justify-center gap-2 bg-destructive px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-destructive/90"
    >
      <AlertTriangle class="h-4 w-4 shrink-0" />
      <span>{$t('auth.session.expired_banner')}</span>
    </button>
  </div>
{/if}

<ReAuthModal bind:open={modalOpen} {username} {loading} {error} onSubmit={handleSubmit} />
