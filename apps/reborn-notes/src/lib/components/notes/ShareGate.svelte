<script lang="ts">
  import type { Component } from 'svelte';
  import { base } from '$app/paths';
  import { Card } from '@reborn/ui';

  // Branded blocking-state layout for the public share viewer. Mirrors the
  // visual rhythm of the `password-prompt` block in `/s/[slug]/+page.svelte`
  // (centered max-w-md column, logo on top, Card below) so every gate the
  // recipient can hit reads as the same surface.
  //
  // Two reasons this is its own component, not inlined per-state:
  // 1. The 7 blocking states would otherwise be 7 copies of the same markup.
  // 2. Recipients arriving via a dead link land here without any in-app
  //    context, so layout consistency across states is more important than
  //    on logged-in screens.
  //
  // `cta` is optional and intentionally understated (text link, not button).
  // It is shown only for "the link is just gone" states (expired / revoked /
  // exhausted / not-found) - not for recoverable states like missing-key or
  // decrypt-failed, where a marketing nudge would muddle the actual fix
  // ("copy the whole URL").
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
    <img src="{base}/logo-black.svg" alt="re/notes" class="block h-5 w-auto dark:hidden" />
    <img
      src="{base}/logo-white.svg"
      alt="re/notes"
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
      <!-- eslint-disable svelte/no-navigation-without-resolve (external URL; resolve() is for internal routes only) -->
      <a
        href={cta.href}
        target="_blank"
        rel="noopener noreferrer"
        class="text-sm text-primary underline-offset-2 hover:underline"
      >
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
        {cta.label}
      </a>
    {/if}
  </Card>
</div>
