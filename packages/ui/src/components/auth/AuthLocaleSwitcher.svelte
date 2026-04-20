<script lang="ts">
  import { locale } from 'svelte-i18n';
  import { changeLocale, SUPPORTED_LOCALES, LOCALE_NAMES } from '@reborn/i18n';
  import { Globe } from '@lucide/svelte';

  type Locale = (typeof SUPPORTED_LOCALES)[number];

  const localeNames = LOCALE_NAMES as Record<string, string>;
  let currentLocale = $derived(($locale as Locale) || 'en');

  function handleChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const newLocale = target.value as Locale;
    if (SUPPORTED_LOCALES.includes(newLocale)) {
      changeLocale(newLocale);
    }
  }
</script>

<div class="flex items-center gap-1.5">
  <Globe class="h-4 w-4 text-muted-foreground" />
  <select
    value={currentLocale}
    onchange={handleChange}
    class="appearance-none bg-transparent text-sm text-muted-foreground hover:text-foreground cursor-pointer border-none outline-none focus:ring-0 pr-5 py-1"
    aria-label="Language"
  >
    {#each SUPPORTED_LOCALES as loc}
      <option value={loc} class="bg-background text-foreground">
        {localeNames[loc]}
      </option>
    {/each}
  </select>
</div>
