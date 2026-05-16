<script lang="ts">
  import type { Component } from 'svelte';
  import { base } from '$app/paths';
  import { Card } from '@reborn/ui';

  // Branded blocking-state layout for the public share viewer. Sister to the
  // notes-side `ShareGate.svelte` - kept as a per-app file because the logo
  // alt-text and brand naming are app-specific, and the share viewer pages
  // already live per-app (no current packages/ui home for share UI). See the
  // notes-side component for the design rationale.
  let {
    icon: Icon,
    title,
    hint,
    cta = null
  }: {
    icon: Component<{ class?: string }>;
    title: string;
    hint: string;
    cta?: { label: string; href: string } | null;
  } = $props();
</script>

<div class="mx-auto flex w-full max-w-md flex-col items-center gap-6 pt-4 sm:pt-12">
  <div class="flex flex-col items-center gap-3 text-center">
    <img src="{base}/logo-black.svg" alt="re/task" class="block h-5 w-auto dark:hidden" />
    <img
      src="{base}/logo-white.svg"
      alt="re/task"
      class="hidden h-5 w-auto dark:block dark:opacity-80"
    />
  </div>
  <Card class="flex w-full flex-col items-center gap-4 p-8 text-center">
    <div class="rounded-full bg-muted p-3 text-muted-foreground">
      <Icon class="h-6 w-6" />
    </div>
    <h1 class="text-lg font-semibold">{title}</h1>
    <p class="text-sm text-muted-foreground">{hint}</p>
    {#if cta}
      <a
        href={cta.href}
        target="_blank"
        rel="noopener noreferrer"
        class="text-sm text-primary underline-offset-2 hover:underline"
      >
        {cta.label}
      </a>
    {/if}
  </Card>
</div>
