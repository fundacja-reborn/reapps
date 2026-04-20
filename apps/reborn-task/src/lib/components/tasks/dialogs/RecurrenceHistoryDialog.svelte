<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		Button
	} from '@reborn/ui';
	import { t, locale } from '$lib/stores/i18n.store';
	import { goto } from '$lib/utils/navigation';
	import { CheckCircle2, Circle, Clock } from '@lucide/svelte';
	import { recurrenceService } from '$lib/services/recurrence.service';
	import { cn } from '@reborn/ui';

	const localeMap: Record<string, string> = {
		en: 'en-US',
		pl: 'pl-PL'
	};

	let {
		open = $bindable(false),
		templateId,
		currentInstanceId
	} = $props<{
		open: boolean;
		templateId: string;
		currentInstanceId: string;
	}>();

	type InstanceItem = {
		id: string;
		due_date: string | null | undefined;
		is_completed: boolean;
		title: string;
	};

	let instances = $state<InstanceItem[]>([]);
	let isLoading = $state(false);

	$effect(() => {
		if (open && templateId) {
			loadInstances();
		}
	});

	async function loadInstances() {
		isLoading = true;
		try {
			instances = await recurrenceService.getTemplateInstances(templateId);
		} catch {
			instances = [];
		} finally {
			isLoading = false;
		}
	}

	function formatDate(dateString: string | null | undefined): string {
		if (!dateString) return '—';
		const browserLocale = localeMap[$locale || 'en'] || 'en-US';
		return new Date(dateString).toLocaleDateString(browserLocale, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	async function handleNavigate(id: string) {
		open = false;
		await goto(`/tasks/${id}`);
	}
</script>

<Dialog bind:open>
	<DialogContent class="max-w-sm sm:max-w-md">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<Clock class="h-5 w-5" />
				{$t('task.recurring_instance.history_title')}
			</DialogTitle>
		</DialogHeader>

		<div class="max-h-72 overflow-y-auto -mx-1 px-1">
			{#if isLoading}
				<p class="text-sm text-muted-foreground py-4 text-center">{$t('common.loading')}</p>
			{:else if instances.length === 0}
				<p class="text-sm text-muted-foreground py-4 text-center">
					{$t('task.recurring_instance.history_empty')}
				</p>
			{:else}
				<ul class="space-y-1">
					{#each instances as item (item.id)}
						{@const isCurrent = item.id === currentInstanceId}
						<li>
							<button
								class={cn(
									'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm',
									'hover:bg-accent transition-colors',
									isCurrent && 'bg-accent/60 font-medium'
								)}
								onclick={() => handleNavigate(item.id)}
							>
								{#if item.is_completed}
									<CheckCircle2 class="h-4 w-4 shrink-0 text-green-500" />
								{:else}
									<Circle class="h-4 w-4 shrink-0 text-muted-foreground" />
								{/if}
								<span class="flex-1 truncate">{formatDate(item.due_date)}</span>
								{#if isCurrent}
									<span class="text-xs text-muted-foreground shrink-0">
										{$t('task.recurring_instance.history_current')}
									</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="flex justify-end pt-2">
			<Button variant="outline" onclick={() => (open = false)}>
				{$t('common.close')}
			</Button>
		</div>
	</DialogContent>
</Dialog>
