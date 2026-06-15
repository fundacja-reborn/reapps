<!--
  @component
  Sidebar search bar — input + "search in descriptions" toggle.

  Mirrors `apps/reborn-notes/src/lib/components/notes/NoteListSearchBar.svelte`:
  pure presentational component, parent owns the state. The parent binds two
  values (`searchInput`, `searchInDescription`) and reacts via $effect — wiring
  to `taskListView.setSearch(...)` lives in `<SidebarTaskList>`, not here.
-->
<script lang="ts">
	import { Search, X } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { cn } from '@reborn/ui';

	let {
		searchInput = $bindable(''),
		searchInDescription = $bindable(false),
		searchInputEl = $bindable<HTMLInputElement | null>(null)
	}: {
		searchInput: string;
		searchInDescription: boolean;
		searchInputEl?: HTMLInputElement | null;
	} = $props();

	function handleSearchInput(e: Event) {
		searchInput = (e.target as HTMLInputElement).value;
	}

	function clearSearch() {
		searchInput = '';
		searchInDescription = false;
	}

	function toggleSearchInDescription() {
		searchInDescription = !searchInDescription;
	}
</script>

<div class="shrink-0 px-3 pb-2">
	<div class="relative">
		<Search class="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
		<input
			bind:this={searchInputEl}
			type="text"
			placeholder={$t('common.search', { default: 'Szukaj...' })}
			value={searchInput}
			oninput={handleSearchInput}
			class="w-full rounded-md border bg-background py-2 pl-7 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
			aria-label={$t('common.search', { default: 'Szukaj...' })}
		/>
		{#if searchInput}
			<button
				type="button"
				onclick={clearSearch}
				class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-foreground"
				aria-label={$t('common.clear_search', { default: 'Wyczyść wyszukiwanie' })}
			>
				<X class="h-3.5 w-3.5" />
			</button>
		{/if}
	</div>
	{#if searchInput}
		<!-- Mobile: 44px-tall tap target (HIG minimum) with breathing room from the
		     input; desktop keeps the compact text-row look via md:. Mirrors the Notes
		     app's NoteListSearchBar. -->
		<div class="mt-0.5 md:mt-1 flex items-center justify-between gap-2">
			<button
				type="button"
				onclick={toggleSearchInDescription}
				class={cn(
					'flex min-h-[44px] md:min-h-0 items-center gap-2 md:gap-1 px-1 -mx-1 md:px-0 md:mx-0 text-left text-sm md:text-[11px] transition-colors',
					searchInDescription
						? 'font-medium text-primary'
						: 'text-muted-foreground hover:text-foreground'
				)}
			>
				<span
					class={cn(
						'inline-flex h-5 w-5 md:h-3 md:w-3 items-center justify-center rounded border',
						searchInDescription
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-muted-foreground'
					)}
				>
					{#if searchInDescription}✓{/if}
				</span>
				{$t('search.search_in_descriptions')}
			</button>
		</div>
	{/if}
</div>
