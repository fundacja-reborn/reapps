<!-- AuthLayout.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Card, CardContent } from '../card';
  import AuthLocaleSwitcher from './AuthLocaleSwitcher.svelte';
  import AuthThemeSwitcher from './AuthThemeSwitcher.svelte';

  let {
    title = '',
    subtitle = '',
    header,
    children,
    footer,
    showLocaleSwitcher = true,
    showThemeSwitcher = true,
    themeStorageKey = 'reborn-theme'
  } = $props<{
    title?: string;
    subtitle?: string;
    header?: Snippet;
    children: Snippet;
    footer?: Snippet;
    showLocaleSwitcher?: boolean;
    showThemeSwitcher?: boolean;
    themeStorageKey?: string;
  }>();
</script>

<!-- height/min-height subtract --rn-keyboard-inset (set on :root by the app
     layout's visual-viewport tracker; 0/unset elsewhere) so the soft keyboard
     does not overlap the focused field on iOS native: the scroll viewport
     shrinks to the area above the keyboard, re-centering a short card there and
     letting a tall form scroll its focused input into view. -->
<div class="h-[calc(100dvh-var(--rn-keyboard-inset,0px))] overflow-y-auto">
  <div
    class="min-h-[calc(100dvh-var(--rn-keyboard-inset,0px))] flex items-center justify-center px-4 sm:px-6 lg:px-8 py-8 relative"
  >
    {#if showLocaleSwitcher || showThemeSwitcher}
      <!-- top: max() keeps the switchers below the iOS notch/Dynamic Island (env() is 0 elsewhere) -->
      <div
        class="absolute top-[max(1rem,env(safe-area-inset-top,0px))] right-4 flex items-center gap-2"
      >
        {#if showThemeSwitcher}
          <AuthThemeSwitcher {themeStorageKey} />
        {/if}
        {#if showLocaleSwitcher}
          <AuthLocaleSwitcher />
        {/if}
      </div>
    {/if}

    <div class="max-w-md w-full space-y-8">
      {#if header || title || subtitle}
        <div class="text-center">
          {#if header}
            <div class="flex justify-center mb-2">
              {@render header()}
            </div>
          {:else if title}
            <h2 class="text-3xl font-bold tracking-tight">
              {title}
            </h2>
          {/if}
          {#if subtitle}
            <p class="mt-2 text-sm text-muted-foreground">
              {subtitle}
            </p>
          {/if}
        </div>
      {/if}

      <Card>
        <CardContent class="p-6 sm:p-8">
          {@render children()}
        </CardContent>
      </Card>

      {#if footer}
        <div class="text-center">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
</div>
