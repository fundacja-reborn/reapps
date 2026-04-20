<script lang="ts">
	import { Search, X } from '@lucide/svelte';
	import { Input, Button } from '@reborn/ui';
	import { searchStore, searchQuery, searchInDescription } from '$lib/stores/search-results.store';
	import { t } from '$lib/stores/i18n.store';
	import { useSidebar } from '@reborn/ui/sidebar';
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import { goto } from '$lib/utils/navigation';

	// Local value derived from search store (single source of truth)
	let inputValue = $derived($searchQuery);
	let inputElement = $state<HTMLInputElement | null>(null);

	// Get sidebar context for mobile detection
	const sidebar = useSidebar();

	// Handle input change (no search, just update local state)
	function handleInput(event: Event) {
		const target = event.target as HTMLInputElement;
		// Update query in store — inputValue will follow via $derived
		searchStore.updateQuery(target.value);
	}

	// Handle search submission
	async function handleSearch() {
		if (!inputValue.trim()) return;

		// Perform search
		searchStore.search(inputValue);

		// Navigate to search page
		await goto('/search');

		// Close sidebar on mobile after search
		if (sidebar.isMobile) {
			await tick();
			sidebar.setOpenMobile(false);
		}
	}

	// Handle clear
	function handleClear() {
		searchStore.clear();
		inputElement?.focus();
	}

	// Toggle search in descriptions
	function toggleSearchInDescription() {
		searchStore.setSearchInDescription(!$searchInDescription);
	}

	// Handle keyboard shortcuts
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleClear();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			handleSearch();
		}
	}

	// Focus on mount if needed
	onMount(() => {
		// Optional: auto-focus on mount
		// inputElement?.focus();
	});
</script>

<div class="px-2 py-2">
	<div class="relative flex items-center gap-1">
		<Search
			class="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
		/>
		<Input
			bind:ref={inputElement}
			type="text"
			placeholder={inputValue ? $t('search.press_enter') : $t('search.placeholder')}
			value={inputValue}
			oninput={handleInput}
			onkeydown={handleKeydown}
			class="h-9 pl-8 {inputValue ? 'pr-8' : 'pr-2'} flex-1"
			autocomplete="off"
			spellcheck="false"
		/>
		{#if inputValue && !sidebar.isMobile}
			<Button
				variant="ghost"
				size="icon"
				onclick={handleClear}
				class="absolute right-0 top-0 h-9 w-9 hover:bg-transparent"
				title={$t('search.clear')}
			>
				<X class="h-3.5 w-3.5" />
			</Button>
		{/if}

		<!-- Search button on mobile -->
		{#if sidebar.isMobile && inputValue}
			<Button
				size="icon"
				variant="ghost"
				onclick={handleSearch}
				class="h-9 w-9 shrink-0"
				title={$t('search.search')}
			>
				<Search class="h-4 w-4" />
			</Button>
		{/if}
	</div>

	{#if inputValue}
		<label
			class="flex items-center gap-2 px-1 pt-1.5 text-xs text-muted-foreground cursor-pointer select-none"
		>
			<button
				type="button"
				role="checkbox"
				aria-checked={$searchInDescription}
				onclick={toggleSearchInDescription}
				class="h-3.5 w-3.5 rounded border border-muted-foreground/50 flex items-center justify-center
					{$searchInDescription ? 'bg-primary border-primary text-primary-foreground' : ''}"
			>
				{#if $searchInDescription}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="3"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="h-2.5 w-2.5"><polyline points="20 6 9 17 4 12"></polyline></svg
					>
				{/if}
			</button>
			{$t('search.search_in_descriptions')}
		</label>
	{/if}
</div>
