<script lang="ts">
	import type { Snippet } from 'svelte';
	// Tasks layout inherits from the main (app) layout
	// which already provides the sidebar structure

	// Get children prop for Svelte 5
	let { children } = $props<{ children?: Snippet }>();
</script>

<!-- Render children using Svelte 5 syntax -->
{#if children}
	{@render children()}
{/if}
