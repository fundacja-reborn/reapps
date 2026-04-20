<script lang="ts">
	import { page, navigating } from '$app/stores';
	import { base } from '$app/paths';
	import { goto } from '$lib/utils/navigation';
	import { browser } from '$app/environment';
	import { session } from '$lib/stores/auth.store';
	import type { Snippet } from 'svelte';

	let { children } = $props<{ children: Snippet }>();

	let isRedirecting = $state(false);

	// Fallback redirect: if the user lands on an auth page while already authenticated
	// (e.g. page refresh, direct URL access), this effect navigates them away.
	// The login page handles its own redirect via goto() after successful login;
	// the $navigating guard below ensures this effect does NOT fire a competing goto().
	$effect(() => {
		if (!browser || !$session.isInitialized || $session.isLoading) return;
		if (isRedirecting) return;
		// Don't redirect while another navigation is already in progress
		if ($navigating) return;

		if ($session.isAuthenticated) {
			const path = $page.url.pathname;
			// Don't redirect on unlock page — it's for authenticated users who need to enter
			// their master password to activate E2E. The page manages its own redirects.
			if (path === `${base}/auth/unlock` || path === '/auth/unlock') return;
			// Don't redirect on 2FA page — it manages its own flow
			if (path === `${base}/auth/2fa` || path === '/auth/2fa') return;

			// User is already logged in, redirect to dashboard or returnTo
			const url = new URL($page.url);
			const returnTo = url.searchParams.get('returnTo') || '/all';
			isRedirecting = true;
			goto(returnTo, { replaceState: true }).finally(() => {
				isRedirecting = false;
			});
		}
	});
</script>

{#if children}
	{@render children()}
{/if}
