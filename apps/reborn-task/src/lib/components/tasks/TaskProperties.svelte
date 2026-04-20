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
	import { X, RotateCw } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { DateTimePicker, RecurrenceDialog, TaskPropertyItem } from '$lib/components/tasks';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('TaskProperties');

	let {
		dueDate,
		hasTime,
		isRecurring,
		recurrenceRule,
		isSaving = false,
		hideRecurrence = false,
		onUpdate
	} = $props<{
		dueDate?: string;
		hasTime: boolean;
		isRecurring: boolean;
		recurrenceRule: string | null;
		isSaving?: boolean;
		hideRecurrence?: boolean;
		onUpdate: (updates: {
			due_date?: string | null;
			has_time: boolean;
			is_recurring: boolean;
			recurrence_rule: string | null;
		}) => Promise<void>;
	}>();

	// Dialog states
	let recurrenceDialogOpen = $state(false);
	let removeDateDialogOpen = $state(false);
	let removeRecurrenceDialogOpen = $state(false);

	// Get recurrence display text
	function getRecurrenceText(rrule: string | null): string {
		if (!rrule) {
			logger.debug('getRecurrenceText: rrule is null/empty');
			return '';
		}

		try {
			const rule = rrule.split(';').reduce((acc: Record<string, string>, part: string) => {
				const [key, value] = part.split('=');
				acc[key] = value;
				return acc;
			}, {});

			let text = '';
			const freq = rule.FREQ?.toLowerCase();
			const interval = parseInt(rule.INTERVAL || '1');

			if (!freq) {
				logger.warn('getRecurrenceText: No FREQ found in rrule', { rrule });
				return '';
			}

			if (interval === 1) {
				text = $t(`task.recurrence.frequency.${freq}`);
			} else {
				text = $t(`task.recurrence.every_n.${freq}`, { values: { n: interval } });
			}

			if (rule.COUNT) {
				text += ` · ${$t('task.recurrence.n_times', { values: { n: parseInt(rule.COUNT) } })}`;
			} else if (rule.UNTIL) {
				const year = rule.UNTIL.substring(0, 4);
				const month = rule.UNTIL.substring(4, 6);
				const day = rule.UNTIL.substring(6, 8);
				const date = new Date(`${year}-${month}-${day}`);
				text += ` · ${$t('task.recurrence.until')} ${date.toLocaleDateString()}`;
			}

			return text;
		} catch (error: unknown) {
			logger.error('getRecurrenceText: Error parsing rrule', { rrule, error });
			return '';
		}
	}

	// Handle date change
	function handleDateChange(newDate: string | null, newHasTime: boolean) {
		// If clearing date and had value before, show confirmation dialog
		// - for templates: when there are recurrence settings to clear
		// - for instances (hideRecurrence=true): always, to warn about detaching from cycle
		if (!newDate && dueDate && (isRecurring || recurrenceRule || hideRecurrence)) {
			removeDateDialogOpen = true;
			return;
		}

		// If clearing date, also clear recurrence
		const updates = {
			due_date: newDate || null, // Use null instead of undefined for clearing
			has_time: newHasTime,
			is_recurring: newDate ? isRecurring : false,
			recurrence_rule: newDate ? recurrenceRule : null
		};

		onUpdate(updates);
	}

	// Handle recurrence save
	function handleRecurrenceSave(rrule: string | null) {
		const updates = {
			due_date: dueDate,
			has_time: hasTime,
			is_recurring: !!rrule,
			recurrence_rule: rrule
		};

		onUpdate(updates);
	}

	// Remove date
	async function handleRemoveDate() {
		removeDateDialogOpen = false;
		await onUpdate({
			due_date: null, // Use null to clear the date
			has_time: false,
			is_recurring: false,
			recurrence_rule: null
		});
	}

	// Remove recurrence
	async function handleRemoveRecurrence() {
		removeRecurrenceDialogOpen = false;
		await onUpdate({
			due_date: dueDate,
			has_time: hasTime,
			is_recurring: false,
			recurrence_rule: null
		});
	}
</script>

<div class="space-y-2">
	<!-- Due date -->
	<div class="flex items-center gap-2">
		<DateTimePicker
			bind:value={dueDate}
			bind:hasTime
			minDate={new Date().toISOString().split('T')[0]}
			onChange={handleDateChange}
			disabled={isSaving}
			placeholder={$t('task.placeholders.due_date')}
			variant="ghost"
		/>
		{#if dueDate}
			<Button
				variant="ghost"
				size="icon"
				onclick={() => (removeDateDialogOpen = true)}
				disabled={isSaving}
				class="h-6 w-6"
				aria-label={$t('task.remove_date')}
			>
				<X class="h-3 w-3" />
			</Button>
		{/if}
	</div>

	<!-- Recurrence -->
	{#if dueDate && !hideRecurrence}
		<TaskPropertyItem
			icon={RotateCw}
			value={isRecurring ? getRecurrenceText(recurrenceRule) : ''}
			placeholder={$t('task.recurrence_label')}
			hasValue={isRecurring}
			onclick={() => (recurrenceDialogOpen = true)}
			onremove={() => (removeRecurrenceDialogOpen = true)}
			disabled={isSaving}
		/>
	{/if}
</div>

<!-- Recurrence dialog -->
<RecurrenceDialog
	bind:open={recurrenceDialogOpen}
	rrule={recurrenceRule}
	{isRecurring}
	onSave={handleRecurrenceSave}
/>

<!-- Remove date confirmation -->
<Dialog bind:open={removeDateDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{$t('task.remove_date_title')}</DialogTitle>
			<DialogDescription>
				{hideRecurrence
					? $t('task.remove_date_instance_description')
					: $t('task.remove_date_description')}
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (removeDateDialogOpen = false)}>
				{$t('common.cancel')}
			</Button>
			<Button variant="destructive" onclick={handleRemoveDate}>
				{$t('common.remove')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Remove recurrence confirmation -->
<Dialog bind:open={removeRecurrenceDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{$t('task.remove_recurrence_title')}</DialogTitle>
			<DialogDescription>
				{$t('task.remove_recurrence_description')}
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (removeRecurrenceDialogOpen = false)}>
				{$t('common.cancel')}
			</Button>
			<Button variant="destructive" onclick={handleRemoveRecurrence}>
				{$t('common.remove')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
