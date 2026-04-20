<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$lib/utils/navigation';
	import { decryptedLists } from '$lib/stores/decrypted-lists.store';
	import { session } from '$lib/stores/auth.store';
	import { Skeleton } from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';
	import { onMount } from 'svelte';

	let isLoading = $state(true);

	// Navigate to default or first list when available
	$effect(() => {
		if (!browser || !$session.hasE2E) return;

		if ($decryptedLists.length > 0) {
			// Find default list
			const defaultList = $decryptedLists.find(list => list.is_default);
			const targetList = defaultList || $decryptedLists[0];
			
			// Navigate to the list
			goto(`/lists/${targetList.id}`);
		} else {
			// No lists available
			isLoading = false;
		}
	});
</script>

<div class="container mx-auto p-6">
	{#if isLoading}
		<!-- Loading skeleton -->
		<div class="space-y-4">
			<Skeleton class="h-8 w-64" />
			<Skeleton class="h-4 w-48" />
			<div class="mt-8">
				<Skeleton class="h-32 w-full" />
			</div>
		</div>
	{:else}
		<!-- No lists found -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<h2 class="text-2xl font-semibold mb-2">{$t('taskList.welcome')}</h2>
			<p class="text-lg text-muted-foreground mb-4">
				{$t('taskList.no_lists_yet')}
			</p>
			<p class="text-sm text-muted-foreground">
				{$t('taskList.create_first_list_hint')}
			</p>
		</div>
	{/if}
</div>
