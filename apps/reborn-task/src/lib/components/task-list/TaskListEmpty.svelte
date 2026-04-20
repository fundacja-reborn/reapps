<script lang="ts">
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@reborn/ui';
	import { Plus } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
</script>

<Card>
	<CardHeader>
		<CardTitle>{$t('tasks.my_tasks')}</CardTitle>
		<CardDescription>
			{$t('task.dashboard.tasks_coming_soon')}
		</CardDescription>
	</CardHeader>
	<CardContent>
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<Plus class="h-12 w-12 text-muted-foreground mb-4" />
			<p class="text-lg font-medium mb-2">{$t('taskList.no_tasks')}</p>
			<p class="text-sm text-muted-foreground">
				{$t('task.dashboard.tasks_coming_soon')}
			</p>
		</div>
	</CardContent>
</Card>
