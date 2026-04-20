<!--
  @component
  Empty state for desktop main content area.
  Shows "select a task" when tasks exist, or "create your first task" when none exist.
-->
<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { Button } from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';
	import { tasks as allDecryptedTasks } from '$lib/stores/decrypted-tasks.store';

	let {
		onCreateTask
	}: {
		onCreateTask?: () => void;
	} = $props();

	const hasTasks = $derived(($allDecryptedTasks ?? []).length > 0);
</script>

<div class="flex flex-1 flex-col items-center justify-center h-full text-center px-6">
	{#if hasTasks}
		<div class="flex flex-col items-center gap-1 text-center">
			<p class="text-sm text-muted-foreground">
				{$t('task.select_from_list', { default: 'Wybierz zadanie z listy' })}
			</p>
			<p class="text-xs text-muted-foreground/60">
				{$t('e2e.badge_tooltip', { default: 'Twoje zadania są szyfrowane end-to-end' })}
			</p>
		</div>
	{:else}
		<div class="flex flex-col items-center gap-1 text-center">
			<p class="text-sm text-muted-foreground">
				{$t('task.no_tasks_yet_hint', { default: 'Utwórz swoje pierwsze zadanie, aby rozpocząć' })}
			</p>
			<p class="text-xs text-muted-foreground/60">
				{$t('e2e.badge_tooltip', { default: 'Twoje zadania są szyfrowane end-to-end' })}
			</p>
		</div>
		{#if onCreateTask}
			<Button variant="outline" class="mt-6" onclick={onCreateTask}>
				<Plus class="h-4 w-4 mr-2" />
				{$t('task.add_new', { default: 'Nowe zadanie' })}
			</Button>
		{/if}
	{/if}
</div>
