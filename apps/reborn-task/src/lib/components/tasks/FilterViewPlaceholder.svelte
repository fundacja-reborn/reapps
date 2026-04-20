<!--
  @component
  Desktop main panel placeholder for filter views (all, today, starred, upcoming, no_date, overdue, trash).
  Shows quick-add input (with contextual metadata) for sections that support it.
  For overdue/trash — shows only "select a task" message without quick-add.
-->
<script lang="ts">
	import { Lock } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { tasks as allDecryptedTasks } from '$lib/stores/decrypted-tasks.store';
	import QuickAddTask from './QuickAddTask.svelte';
	import type { Section } from '$lib/components/layout/IconNav.svelte';

	let {
		section = 'all'
	}: {
		section: Section;
	} = $props();

	const filterSection = $derived(section === 'lists' ? 'all' : section);
	const hasTasks = $derived(($allDecryptedTasks ?? []).length > 0);
	const showQuickAdd = $derived(filterSection !== 'overdue' && filterSection !== 'trash');

	let quickAddRef = $state<QuickAddTask | undefined>(undefined);

	export function focusQuickAdd() {
		quickAddRef?.focus();
	}
</script>

<div class="flex flex-1 flex-col items-center justify-center h-full text-center px-6 gap-8">
	{#if showQuickAdd}
		<div class="w-full max-w-md">
			<QuickAddTask
				bind:this={quickAddRef}
				showListSelect
				section={filterSection}
			/>
		</div>
	{/if}

	<div class="flex flex-col items-center gap-1">
		{#if showQuickAdd && hasTasks}
			<p class="text-xs text-muted-foreground/60">
				{$t('task.select_from_list_or')}
			</p>
		{:else if hasTasks}
			<p class="text-sm text-muted-foreground">
				{$t('task.select_from_list')}
			</p>
		{:else}
			<p class="text-sm text-muted-foreground">
				{$t('task.no_tasks_yet_hint')}
			</p>
		{/if}
		<p class="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
			<Lock class="h-3 w-3" />
			{$t('e2e.badge_tooltip')}
		</p>
	</div>
</div>
