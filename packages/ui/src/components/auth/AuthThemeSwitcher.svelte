<script lang="ts">
  import { Sun, Moon, Monitor } from '@lucide/svelte';

  let { themeStorageKey = 'reborn-theme' } = $props<{
    themeStorageKey?: string;
  }>();

  type Theme = 'light' | 'dark' | 'system';

  let currentTheme = $state<Theme>(getInitialTheme());

  function getInitialTheme(): Theme {
    if (typeof window === 'undefined') return 'system';
    const stored = localStorage.getItem(themeStorageKey);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    return 'system';
  }

  function applyTheme(theme: Theme) {
    const root = document.documentElement;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      /* quota / private mode */
    }
  }

  function cycleTheme() {
    const cycle: Theme[] = ['light', 'dark', 'system'];
    const idx = cycle.indexOf(currentTheme);
    currentTheme = cycle[(idx + 1) % cycle.length];
    applyTheme(currentTheme);
  }
</script>

<button
  type="button"
  onclick={cycleTheme}
  class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
  aria-label="Toggle theme"
  title={currentTheme === 'light' ? 'Light' : currentTheme === 'dark' ? 'Dark' : 'System'}
>
  {#if currentTheme === 'light'}
    <Sun class="h-4 w-4" />
  {:else if currentTheme === 'dark'}
    <Moon class="h-4 w-4" />
  {:else}
    <Monitor class="h-4 w-4" />
  {/if}
</button>
