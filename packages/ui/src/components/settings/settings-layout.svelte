<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '@reborn/ui';
  import { ChevronLeft } from '@lucide/svelte';
  import { base } from '$app/paths';
  import { cn } from '../../utils/cn';

  let {
    title,
    backHref = '/settings',
    class: className,
    actions,
    children
  }: {
    title: string;
    backHref?: string;
    class?: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();

  let resolvedHref = $derived(
    backHref.startsWith('/') && base && !backHref.startsWith(base + '/')
      ? `${base}${backHref}`
      : backHref
  );
</script>

<!-- height: subtract the session-expired banner (--rn-banner-h) and the soft
     keyboard inset (--rn-keyboard-inset) - both set on :root by the notes
     layout's trackers; 0/unset elsewhere. Banner keeps the page bottom on
     screen when visible; keyboard inset shrinks the scroll viewport to the area
     above the iOS keyboard so a focused field (e.g. change-password / delete
     account) scrolls into view instead of being covered. -->
<div
  class={cn(
    'h-[calc(100dvh-var(--rn-banner-h,0px)-var(--rn-keyboard-inset,0px))] overflow-y-auto bg-background',
    className
  )}
>
  <!-- pt: keep the header below the iOS notch/Dynamic Island (env() is 0 elsewhere) -->
  <div class="sticky top-0 z-10 bg-background border-b pt-[env(safe-area-inset-top,0px)]">
    <div class="container mx-auto max-w-4xl px-4 sm:px-6">
      <div class="flex items-center gap-2 h-14">
        <a
          href={resolvedHref}
          class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-11 w-11 -ml-2"
        >
          <ChevronLeft class="h-5 w-5" />
          <span class="sr-only">Back</span>
        </a>
        <h1 class="text-lg font-semibold">{title}</h1>
        {#if actions}
          <div class="ml-auto">
            {@render actions()}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="container mx-auto max-w-4xl px-4 sm:px-6 py-6">
    {@render children()}
  </div>
</div>
