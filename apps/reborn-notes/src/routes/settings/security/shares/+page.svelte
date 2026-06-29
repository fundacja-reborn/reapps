<script lang="ts">
  import { onMount } from 'svelte';
  import { Share2, ChevronRight } from '@lucide/svelte';
  import { SettingsLayout } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { goto } from '$lib/utils/navigation';
  import { sharesStore, activeSharesCount } from '$lib/stores/shares.store';

  // The full share list now lives in the in-app Shares view (icon rail). This
  // settings entry is a thin shortcut into it - one source of truth, no
  // duplicated list/preview/revoke markup to keep in sync.
  onMount(() => {
    void sharesStore.refresh();
  });
</script>

<svelte:head>
  <title>{$t('share.list.title')} - re/notes</title>
</svelte:head>

<SettingsLayout title={$t('share.list.title')} backHref="/settings">
  <div class="space-y-4">
    <p class="text-sm text-muted-foreground">{$t('share.list.settings_desc')}</p>

    <button
      type="button"
      onclick={() => goto('/?section=shares')}
      class="flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent"
    >
      <Share2 class="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium">{$t('share.list.manage_cta')}</span>
        <span class="block text-xs text-muted-foreground">
          {$t('share.list.count', { values: { count: $activeSharesCount } })}
        </span>
      </span>
      <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  </div>
</SettingsLayout>
