<script lang="ts">
  import { appUpdateStore } from '$lib/stores/app-update.store';
  import { t } from '$lib/stores/i18n.store';
  import { Button } from '@reborn/ui';
  import { Download } from '@lucide/svelte';

  function openStore(url: string) {
    // External origin - Capacitor routes it to the system browser.
    window.open(url, '_blank', 'noopener');
  }
</script>

<!--
  Native min-version gate (Faza 5, plan D5). Full-screen and deliberately
  unclosable: it only appears when the server says this build is below the
  supported minimum (i.e. a critical patch shipped). Local data stays
  untouched and the user stays logged in - after updating from the store the
  app resumes where it left off. Rendered native-gated from +layout.svelte,
  so the web bundle dead-code-eliminates it.
-->
{#if $appUpdateStore.severity === 'required'}
  <div
    class="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background px-8 text-center"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="update-gate-title"
    aria-describedby="update-gate-description"
  >
    <Download class="h-12 w-12 text-muted-foreground" aria-hidden="true" />
    <h1 id="update-gate-title" class="text-xl font-semibold">
      {$t('app.update_gate.required_title')}
    </h1>
    <p id="update-gate-description" class="max-w-sm text-sm text-muted-foreground">
      {$t('app.update_gate.required_description')}
    </p>
    {#if $appUpdateStore.storeUrl}
      {@const storeUrl = $appUpdateStore.storeUrl}
      <Button onclick={() => openStore(storeUrl)}>
        {$t('app.update_gate.open_store')}
      </Button>
    {/if}
  </div>
{/if}
