<script lang="ts">
	import {
		Button,
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '@reborn/ui';
	import * as DropdownMenu from '@reborn/ui/components/dropdown-menu';
	import { RotateCw, History, SkipForward, StopCircle, MoreVertical, Pencil } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import {
		RecurrenceDialog,
		RecurrenceHistoryDialog,
		RecurrenceEditOptionsDialog
	} from '$lib/components/tasks/dialogs';
	import { taskDetailService } from '$lib/services/task-detail.service';

	let {
		instanceId,
		templateId,
		recurrenceRule,
		isSaving = false
	} = $props<{
		instanceId: string;
		templateId: string;
		recurrenceRule: string | null;
		isSaving?: boolean;
	}>();

	// Dialog states
	let historyOpen = $state(false);
	let recurrenceDialogOpen = $state(false);
	let editOptionsOpen = $state(false);
	let skipConfirmOpen = $state(false);
	let stopConfirmOpen = $state(false);

	// Holds the new rrule chosen in RecurrenceDialog before the user picks scope
	let pendingRRule = $state<string | null>(null);

	function getRecurrenceText(rrule: string | null): string {
		if (!rrule) return '';
		try {
			const rule = rrule.split(';').reduce((acc: Record<string, string>, part: string) => {
				const [key, value] = part.split('=');
				acc[key] = value;
				return acc;
			}, {});

			const freq = rule.FREQ?.toLowerCase();
			const interval = parseInt(rule.INTERVAL || '1');
			if (!freq) return '';

			let text =
				interval === 1
					? $t(`task.recurrence.frequency.${freq}`)
					: $t(`task.recurrence.every_n.${freq}`, { values: { n: interval } });

			if (rule.COUNT) {
				text += ` · ${$t('task.recurrence.n_times', { values: { n: parseInt(rule.COUNT) } })}`;
			} else if (rule.UNTIL) {
				const y = rule.UNTIL.substring(0, 4);
				const m = rule.UNTIL.substring(4, 6);
				const d = rule.UNTIL.substring(6, 8);
				const date = new Date(`${y}-${m}-${d}`);
				text += ` · ${$t('task.recurrence.until')} ${date.toLocaleDateString()}`;
			}
			return text;
		} catch {
			return '';
		}
	}

	// Step 1: user saves a new rule in RecurrenceDialog
	function handleRecurrenceSave(rrule: string | null) {
		pendingRRule = rrule;
		recurrenceDialogOpen = false;
		editOptionsOpen = true;
	}

	// Step 2: user picks scope in RecurrenceEditOptionsDialog
	async function handleEditOptionConfirm(option: 'this_and_future' | 'all') {
		editOptionsOpen = false;
		await taskDetailService.editRecurrenceFromInstance(pendingRRule, option);
		pendingRRule = null;
	}

	function handleEditOptionCancel() {
		pendingRRule = null;
	}

	async function handleSkipConfirm() {
		skipConfirmOpen = false;
		await taskDetailService.skipInstance();
	}

	async function handleStopConfirm() {
		stopConfirmOpen = false;
		await taskDetailService.stopRecurrence();
	}
</script>

<div class="flex items-center gap-2 px-2 py-1 text-sm">
	<RotateCw class="h-4 w-4 shrink-0 text-muted-foreground" />
	<span class="flex-1 text-muted-foreground">
		{getRecurrenceText(recurrenceRule) || $t('task.recurring_instance.recurrence_info')}
	</span>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					class="h-7 w-7 text-muted-foreground"
					disabled={isSaving}
					aria-label={$t('tasks.more_options')}
				>
					<MoreVertical class="h-4 w-4" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end">
			<DropdownMenu.Item onclick={() => (recurrenceDialogOpen = true)}>
				<Pencil class="mr-2 h-4 w-4" />
				{$t('task.recurring_instance.edit_recurrence')}
			</DropdownMenu.Item>
			<DropdownMenu.Item onclick={() => (historyOpen = true)}>
				<History class="mr-2 h-4 w-4" />
				{$t('task.recurring_instance.history')}
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onclick={() => (skipConfirmOpen = true)}>
				<SkipForward class="mr-2 h-4 w-4" />
				{$t('task.recurring_instance.skip')}
			</DropdownMenu.Item>
			<DropdownMenu.Item class="text-destructive" onclick={() => (stopConfirmOpen = true)}>
				<StopCircle class="mr-2 h-4 w-4" />
				{$t('task.recurring_instance.stop_cycle')}
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>

<!-- Recurrence edit dialog (step 1: pick rule) -->
<RecurrenceDialog
	bind:open={recurrenceDialogOpen}
	rrule={recurrenceRule}
	isRecurring={!!recurrenceRule}
	onSave={handleRecurrenceSave}
/>

<!-- Edit options dialog (step 2: pick scope) -->
<RecurrenceEditOptionsDialog
	bind:open={editOptionsOpen}
	onConfirm={handleEditOptionConfirm}
	onCancel={handleEditOptionCancel}
/>

<!-- History dialog -->
<RecurrenceHistoryDialog bind:open={historyOpen} {templateId} currentInstanceId={instanceId} />

<!-- Skip confirmation -->
<Dialog bind:open={skipConfirmOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<SkipForward class="h-5 w-5" />
				{$t('task.recurring_instance.skip_title')}
			</DialogTitle>
			<DialogDescription>
				{$t('task.recurring_instance.skip_description')}
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (skipConfirmOpen = false)}>
				{$t('common.cancel')}
			</Button>
			<Button onclick={handleSkipConfirm}>
				{$t('task.recurring_instance.skip')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Stop cycle confirmation -->
<Dialog bind:open={stopConfirmOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<StopCircle class="h-5 w-5 text-destructive" />
				{$t('task.recurring_instance.stop_cycle_title')}
			</DialogTitle>
			<DialogDescription>
				{$t('task.recurring_instance.stop_cycle_description')}
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (stopConfirmOpen = false)}>
				{$t('common.cancel')}
			</Button>
			<Button variant="destructive" onclick={handleStopConfirm}>
				{$t('task.recurring_instance.stop_cycle')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
