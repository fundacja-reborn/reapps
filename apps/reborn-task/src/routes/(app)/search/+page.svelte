<script lang="ts">
	import { SearchResults } from '$lib/components/search';
	import { goto } from '$lib/utils/navigation';
	
	// Handle task click - navigate to task detail page
	async function handleTaskClick(taskId: string) {
		await goto(`/tasks/${taskId}`);
	}
</script>

<div class="container mx-auto px-6 py-0 max-w-4xl h-full">
	<SearchResults onTaskClick={handleTaskClick} />
</div>
