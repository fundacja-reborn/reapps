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

<div class="h-dvh overflow-y-auto">
  <div class="min-h-dvh flex items-center justify-center px-4 sm:px-6 lg:px-8 py-8 relative">
    {#if showLocaleSwitcher || showThemeSwitcher}
      <div class="absolute top-4 right-4 flex items-center gap-2">
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
