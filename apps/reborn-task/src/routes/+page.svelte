<script lang="ts">
  import LoadingScreen from '$lib/components/LoadingScreen.svelte';
  
  // This page should never be shown - redirects happen in +page.ts
  // But we show loading screen just in case
</script>

<!-- Show loading screen in case redirect doesn't happen immediately -->
<LoadingScreen />
