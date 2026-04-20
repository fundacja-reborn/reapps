<!--
	@component
	Completed tasks header content
-->
<script lang="ts">
	import { t } from '$lib/stores/i18n.store';
	import { taskCounts } from '$lib/stores/task-counts.store';
</script>

<div class="flex items-center justify-between w-full">
	<!-- Title (left aligned) -->
	<div class="flex items-center gap-4 flex-shrink">
		<h1 class="text-md font-medium">{$t('task.sidebar.completed_tasks')}</h1>
		{#if $taskCounts.completed > 0}
			<span class="text-xs text-muted-foreground">({$taskCounts.completed})</span>
		{/if}
	</div>
</div>
