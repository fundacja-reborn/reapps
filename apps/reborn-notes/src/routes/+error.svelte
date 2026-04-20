<script lang="ts">
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { browser } from '$app/environment';
  import { onMount, onDestroy } from 'svelte';
  import { AlertTriangle, ArrowLeft, Home, WifiOff, RefreshCw } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';

  let isOffline = $state(browser ? !navigator.onLine : false);

  // Detect offline from either the error payload or live navigator state
  let showOffline = $derived(!!$page.error?.isOffline || isOffline);

  let removeOnlineListener: (() => void) | undefined;

  onMount(() => {
    const updateOnline = () => {
      isOffline = !navigator.onLine;
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    // Auto-reload when connection is restored and we're on the offline error page
    const handleOnline = () => {
      if ($page.error?.isOffline) {
        location.reload();
      }
    };
    window.addEventListener('online', handleOnline);

    removeOnlineListener = () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      window.removeEventListener('online', handleOnline);
    };
  });

  onDestroy(() => {
    removeOnlineListener?.();
  });
</script>

<svelte:head>
  <title>
    {showOffline ? ($t('error.offline_title') || 'Offline') : $page.status === 404 ? 'Nie znaleziono' : 'Błąd'} — re/notes
  </title>
</svelte:head>

<div class="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
  <div class="max-w-md w-full text-center space-y-6">
    {#if showOffline}
      <!-- Offline error view -->
      <div class="flex justify-center">
        <div class="size-16 rounded-2xl bg-muted flex items-center justify-center">
          <WifiOff class="size-8 text-muted-foreground" />
        </div>
      </div>

      <div class="space-y-2">
        <h1 class="text-xl font-semibold">
          {$t('error.offline_title') || 'Jesteś offline'}
        </h1>
        <p class="text-sm text-muted-foreground">
          {$t('error.offline_description') || 'Ta strona nie jest dostępna w trybie offline. Połącz się z internetem i spróbuj ponownie.'}
        </p>
      </div>

      <div class="flex items-center justify-center gap-3">
        <button
          onclick={() => location.reload()}
          class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <RefreshCw class="size-4" />
          {$t('error.retry') || 'Spróbuj ponownie'}
        </button>
        <button
          onclick={() => history.back()}
          class="inline-flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
        >
          <ArrowLeft class="size-4" />
          Wróć
        </button>
      </div>
    {:else}
      <!-- Standard error view -->
      <div class="flex justify-center">
        <div class="size-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <AlertTriangle class="size-8 text-destructive" />
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-5xl font-bold text-muted-foreground/40">{$page.status}</p>
        <h1 class="text-xl font-semibold">
          {#if $page.status === 404}
            Strona nie istnieje
          {:else if $page.status === 403}
            Brak dostępu
          {:else}
            Coś poszło nie tak
          {/if}
        </h1>
        <p class="text-sm text-muted-foreground">
          {$page.error?.message ?? 'Wystąpił nieoczekiwany błąd. Spróbuj odświeżyć stronę.'}
        </p>
      </div>

      <div class="flex items-center justify-center gap-3">
        <a
          href={resolve('/')}
          class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Home class="size-4" />
          Strona główna
        </a>
        <button
          onclick={() => history.back()}
          class="inline-flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
        >
          <ArrowLeft class="size-4" />
          Wróć
        </button>
      </div>
    {/if}
  </div>
</div>
