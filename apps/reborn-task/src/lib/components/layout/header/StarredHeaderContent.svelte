<!-- 
	@component
	Starred tasks header content
-->
<script lang="ts">
	import { t } from '$lib/stores/i18n.store';
	import { syncProgress } from '$lib/services/sync.service';
	import { RefreshCw } from '@lucide/svelte';
	import { TaskSortButton } from '$lib/components/tasks';
</script>

<div class="flex items-center justify-between w-full">
	<!-- Title (left aligned) -->
	<div class="flex items-center gap-4 flex-shrink">
		<h1 class="text-md font-medium">{$t('task.sidebar.starred_tasks')}</h1>
	</div>

	<!-- Sort button (right aligned) -->
	<div class="flex items-center gap-2 flex-shrink-0">
		<!-- Sort button with special ID for starred tasks -->
		<TaskSortButton listId="starred" />
	</div>
</div>

<!-- Sync indicator -->
{#if $syncProgress.isInProgress}
	<div class="flex items-center gap-2 text-sm text-muted-foreground ml-auto">
		<RefreshCw class="h-4 w-4 animate-spin" />
		<span>{$syncProgress.message}</span>
	</div>
{/if}
