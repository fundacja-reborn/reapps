<script lang="ts">
  import { Monitor, Sun, Moon } from '@lucide/svelte';

  type ThemeValue = 'light' | 'dark' | 'system';

  let {
    value = 'system',
    onchange,
    disabled = false,
    labels = { light: 'Light', dark: 'Dark', system: 'System' }
  } = $props<{
    value: ThemeValue;
    onchange: (value: ThemeValue) => void;
    disabled?: boolean;
    labels?: { light: string; dark: string; system: string };
  }>();

  const options: { value: ThemeValue; icon: typeof Sun }[] = [
    { value: 'light', icon: Sun },
    { value: 'dark', icon: Moon },
    { value: 'system', icon: Monitor }
  ];
</script>

<div class="flex rounded-lg border divide-x overflow-hidden">
  {#each options as opt (opt.value)}
    {@const active = value === opt.value}
    <button
      type="button"
      onclick={() => onchange(opt.value)}
      {disabled}
      class="flex flex-1 flex-col items-center gap-1.5 py-4 text-xs transition-colors
        {active
        ? 'bg-accent text-accent-foreground font-medium'
        : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}
        disabled:opacity-50 disabled:pointer-events-none"
    >
      <opt.icon class="h-5 w-5" />
      {labels[opt.value]}
      {#if active}
        <span class="h-1 w-4 rounded-full bg-primary"></span>
      {:else}
        <span class="h-1 w-4"></span>
      {/if}
    </button>
  {/each}
</div>
