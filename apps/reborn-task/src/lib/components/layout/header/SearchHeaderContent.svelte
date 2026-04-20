<script lang="ts">
	import { Search, X } from '@lucide/svelte';
	import { Button, Input } from '@reborn/ui';
	import { goto } from '$lib/utils/navigation';
	import { searchStore, searchQuery, clearSearch } from '$lib/stores/search-results.store';
	import { t } from '$lib/stores/i18n.store';
	import { useSidebar } from '@reborn/ui/sidebar';
	import { onMount } from 'svelte';

	// Local state for input value (only for mobile)
	let inputValue = $state('');
	let inputElement = $state<HTMLInputElement | null>(null);

	// Get sidebar context for mobile detection
	const sidebar = useSidebar();

	// Get current search query
	const query = $derived($searchQuery);

	// Initialize input value with current query on mount
	onMount(() => {
		inputValue = query;
	});

	// Handle search submission
	async function handleSearch() {
		if (!inputValue.trim()) return;
		searchStore.search(inputValue);
	}

	// Handle clear search
	async function handleClearSearch() {
		clearSearch();
		await goto('/');
	}

	// Handle input change (only update local state, don't search)
	function handleInput(event: Event) {
		const target = event.target as HTMLInputElement;
		inputValue = target.value;
	}

	// Handle keyboard shortcuts
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			handleSearch();
		}
	}
</script>

<div class="flex-1 flex items-center gap-2">
	<!-- Search icon and title on desktop, full search on mobile -->
	{#if !sidebar.isMobile}
		<!-- Desktop: Just show icon and title -->
		<div class="flex items-center gap-2">
			<Search class="h-5 w-5 text-muted-foreground" />
			<h1 class="text-lg font-semibold">
				{$t('search.results_title', { values: { query } })}
			</h1>
		</div>

		<!-- Clear button on desktop -->
		<Button
			variant="ghost"
			size="icon"
			onclick={handleClearSearch}
			title={$t('search.clear')}
			class="ml-auto"
		>
			<X class="h-4 w-4" />
		</Button>
	{:else}
		<!-- Mobile: Show only search input in header -->
		<div class="flex-1 flex items-center gap-2">
			<div class="relative flex-1 flex items-center gap-1">
				<Search
					class="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
				/>
				<Input
					bind:ref={inputElement}
					type="text"
					placeholder={$t('search.placeholder')}
					value={inputValue}
					oninput={handleInput}
					onkeydown={handleKeydown}
					class="h-8 pl-8 pr-2 flex-1"
					autocomplete="off"
					spellcheck="false"
				/>
			</div>

			<!-- Search button on mobile -->
			<Button
				size="icon"
				variant="ghost"
				onclick={handleSearch}
				class="h-8 w-8 shrink-0"
				title={$t('search.search')}
			>
				<Search class="h-4 w-4" />
			</Button>

			<!-- Clear/close button -->
			<Button
				variant="ghost"
				size="icon"
				onclick={handleClearSearch}
				title={$t('search.clear')}
				class="h-8 w-8 shrink-0"
			>
				<X class="h-4 w-4" />
			</Button>
		</div>
	{/if}
</div>
