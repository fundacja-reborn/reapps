<!--
	@component
	Generic header content for filter views (all, today, overdue, upcoming, no-date)
-->
<script lang="ts">
	import { t } from '$lib/stores/i18n.store';
	import type { Section } from '$lib/components/layout/IconNav.svelte';
	import { TaskSortButton } from '$lib/components/tasks';

	let { section }: { section: Section } = $props();

	function getSectionTitle(s: Section): string {
		switch (s) {
			case 'all':
				return $t('taskList.filter.all');
			case 'starred':
				return $t('taskList.filter.starred_only');
			case 'overdue':
				return $t('taskList.filter.date.overdue');
			case 'today':
				return $t('taskList.filter.date.today');
			case 'upcoming':
				return $t('taskList.filter.date.upcoming');
			case 'no_date':
				return $t('taskList.filter.date.no_date');
			case 'trash':
				return $t('task.sidebar.trash');
			default:
				return '';
		}
	}
</script>

<div class="flex items-center justify-between w-full">
	<div class="flex items-center gap-4 flex-shrink">
		<h1 class="text-md font-medium">{getSectionTitle(section)}</h1>
	</div>

	<div class="flex items-center gap-2 flex-shrink-0">
		<TaskSortButton listId={section} />
	</div>
</div>
