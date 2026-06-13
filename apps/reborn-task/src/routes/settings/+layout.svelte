<script lang="ts">
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { goto } from '$lib/utils/navigation';
	import { session } from '$lib/stores/auth.store';

	let { children } = $props<{ children?: Snippet }>();

	let isAuthRedirecting = $state(false);

	// Auth guard — same logic as (app) layout
	$effect(() => {
		if (!browser || !$session.isInitialized || $session.isLoading) return;
		if (isAuthRedirecting) return;
		// Local-only / no-account mode is a valid state - never bounce it to login/unlock.
		if ($session.isLocalOnly) return;

		if (!$session.isAuthenticated) {
			const path = $page.url.pathname;
			const returnTo =
				path !== '/' && !path.startsWith(`${base}/auth`) && !path.startsWith('/auth')
					? `?returnTo=${encodeURIComponent(path)}`
					: '';
			isAuthRedirecting = true;
			goto(`/auth/login${returnTo}`, { replaceState: true }).finally(() => {
				isAuthRedirecting = false;
			});
		} else if (!$session.hasE2E) {
			isAuthRedirecting = true;
			goto('/auth/unlock', { replaceState: true }).finally(() => {
				isAuthRedirecting = false;
			});
		}
	});
</script>

{#if children}
	{@render children()}
{/if}
