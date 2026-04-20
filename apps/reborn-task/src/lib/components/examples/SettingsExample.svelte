/**
 * Example of using app-specific settings in a component
 */
<script lang="ts">
  import { onMount } from 'svelte';
  import { getSettings, updateSettings, getSetting, setSetting } from '$lib/utils/app-settings';
  import type { AppSettings } from '@reborn/storage';
  
  let settings = $state<AppSettings | null>(null);
  let isLoading = $state(true);
  
  onMount(async () => {
    // Load settings for this app
    settings = await getSettings();
    isLoading = false;
  });
  
  async function handleThemeChange(theme: AppSettings['theme']) {
    // Update just the theme setting
    await setSetting('theme', theme);
    
    // Or update multiple settings at once
    await updateSettings({
      theme,
      updated_at: new Date().toISOString()
    });
    
    // Reload settings to reflect changes
    settings = await getSettings();
  }
  
  async function toggleNotifications() {
    const currentValue = await getSetting('notifications_enabled');
    await setSetting('notifications_enabled', !currentValue);
    settings = await getSettings();
  }
</script>

{#if isLoading}
  <p>Loading settings...</p>
{:else if settings}
  <div>
    <h3>App Settings for {settings.app_name}</h3>
    
    <label>
      Theme:
      <select onchange={(e) => handleThemeChange(e.currentTarget.value as AppSettings['theme'])}>
        <option value="light" selected={settings.theme === 'light'}>Light</option>
        <option value="dark" selected={settings.theme === 'dark'}>Dark</option>
        <option value="system" selected={settings.theme === 'system'}>System</option>
      </select>
    </label>
    
    <label>
      <input 
        type="checkbox" 
        checked={settings.notifications_enabled}
        onchange={toggleNotifications}
      />
      Enable notifications
    </label>
    
    <p>Language: {settings.language}</p>
    <p>Time format: {settings.timeFormat}</p>
  </div>
{/if}
