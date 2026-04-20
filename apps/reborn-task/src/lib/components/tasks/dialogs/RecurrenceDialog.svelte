<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter,
		Button,
		Input,
		Calendar,
		RadioGroup,
		RadioGroupItem,
		Checkbox,
		Popover,
		PopoverContent,
		PopoverTrigger,
		Label,
		Select, // poprawiony import
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '@reborn/ui';
	import { Calendar as CalendarIcon } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { currentLanguage } from '$lib/stores/app-settings.store';
	import { cn } from '@reborn/ui';
	import { getLocalTimeZone, type DateValue, parseDate } from '@internationalized/date';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('RecurrenceDialog');

	// Props
	let {
		open = $bindable(false),
		rrule = null,
		isRecurring = false,
		onSave
	} = $props<{
		open?: boolean;
		rrule?: string | null;
		isRecurring?: boolean;
		onSave: (rrule: string | null) => void;
	}>();

	// Form state
	let currentFormState = $state({
		frequency: 'WEEKLY',
		interval: 1,
		weekDays: [] as string[],
		endType: 'never',
		occurrences: 10,
		endDate: undefined as DateValue | undefined
	});

	// Weekdays mapping
	const WEEKDAYS = [
		{ value: 'MO', label: 'monday' },
		{ value: 'TU', label: 'tuesday' },
		{ value: 'WE', label: 'wednesday' },
		{ value: 'TH', label: 'thursday' },
		{ value: 'FR', label: 'friday' },
		{ value: 'SA', label: 'saturday' },
		{ value: 'SU', label: 'sunday' }
	];

	let locale = $derived($currentLanguage === 'pl' ? 'pl' : 'en');

	function formatDate(date: DateValue | undefined): string {
		if (!date) return $t('task.select_date');
		const localDate = date.toDate(getLocalTimeZone());
		return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(localDate);
	}

	function generateRRule(): string {
		const freq = currentFormState.frequency;
		const parts = [`FREQ=${freq}`, `INTERVAL=${currentFormState.interval}`];

		if (freq === 'WEEKLY' && currentFormState.weekDays.length > 0) {
			parts.push(`BYDAY=${currentFormState.weekDays.join(',')}`);
		}

		if (currentFormState.endType === 'after') {
			parts.push(`COUNT=${currentFormState.occurrences}`);
		} else if (currentFormState.endType === 'on_date' && currentFormState.endDate) {
			const until = currentFormState.endDate.toString().replace(/-/g, '');
			parts.push(`UNTIL=${until}`);
		}

		return parts.join(';');
	}

	function handleClose() {
		resetForm();
		open = false;
	}

	function handleSave() {
		const rrule = generateRRule();
		logger.debug('Generated RRULE:', rrule);
		onSave(rrule);
		resetForm();
		open = false;
	}

	function handleWeekDayToggle(day: string) {
		const weekDays = [...currentFormState.weekDays];
		if (weekDays.includes(day)) {
			currentFormState.weekDays = weekDays.filter((d) => d !== day);
		} else {
			currentFormState.weekDays = [...weekDays, day];
		}
	}

	function resetForm() {
		currentFormState = {
			frequency: 'WEEKLY',
			interval: 1,
			weekDays: [],
			endType: 'never',
			occurrences: 10,
			endDate: undefined
		};
	}

	// Parse existing RRULE
	$effect(() => {
		if (open) {
			if (rrule && isRecurring) {
				const rule = rrule.split(';').reduce((acc: Record<string, string>, part: string) => {
					const [key, value] = part.split('=');
					acc[key] = value;
					return acc;
				}, {});

				currentFormState = {
					frequency: rule.FREQ || 'WEEKLY',
					interval: parseInt(rule.INTERVAL || '1'),
					weekDays: rule.BYDAY ? rule.BYDAY.split(',') : [],
					endType: rule.COUNT ? 'after' : rule.UNTIL ? 'on_date' : 'never',
					occurrences: rule.COUNT ? parseInt(rule.COUNT) : 10,
					endDate: rule.UNTIL
						? parseDate(
								`${rule.UNTIL.substring(0, 4)}-${rule.UNTIL.substring(4, 6)}-${rule.UNTIL.substring(6, 8)}`
							)
						: undefined
				};
			} else {
				resetForm();
			}
		}
	});

	// Debug frequency changes
	$effect(() => {
		logger.debug('Current frequency:', currentFormState.frequency);
	});
</script>

<Dialog bind:open onOpenChange={handleClose}>
	<DialogContent class="sm:max-w-[500px]">
		<DialogHeader>
			<DialogTitle>{$t('task.recurrence.title')}</DialogTitle>
			<DialogDescription>
				{$t('task.recurrence.description')}
			</DialogDescription>
		</DialogHeader>

		<div class="space-y-4 py-4">
			<div class="flex items-center gap-4">
				<div class="w-24">
					<Label for="interval-input" class="sr-only">
						{$t('task.recurrence.interval.label')}
					</Label>
					<Input
						id="interval-input"
						type="number"
						min="1"
						max="99"
						bind:value={currentFormState.interval}
						class="w-full"
					/>
				</div>
				<div class="flex-1">
					<Select type="single" bind:value={currentFormState.frequency}>
						<SelectTrigger class="w-full" aria-label={$t('task.recurrence.frequency.label')}>
							{$t(`task.recurrence.frequency.${currentFormState.frequency.toLowerCase()}`)}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="DAILY">
								{$t('task.recurrence.frequency.daily')}
							</SelectItem>
							<SelectItem value="WEEKLY">
								{$t('task.recurrence.frequency.weekly')}
							</SelectItem>
							<SelectItem value="MONTHLY">
								{$t('task.recurrence.frequency.monthly')}
							</SelectItem>
							<SelectItem value="YEARLY">
								{$t('task.recurrence.frequency.yearly')}
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{#if currentFormState.frequency === 'WEEKLY'}
				<div class="space-y-2">
					<span id="weekdays-group-label" class="block mb-2">
						{$t('task.recurrence.days.label')}
					</span>
					<div class="grid grid-cols-2 gap-2" role="group" aria-labelledby="weekdays-group-label">
						{#each WEEKDAYS as day}
							<div class="flex items-center space-x-2">
								<Checkbox
									id={day.value}
									checked={currentFormState.weekDays.includes(day.value)}
									onCheckedChange={() => handleWeekDayToggle(day.value)}
								/>
								<Label for={day.value}>
									{$t(`task.recurrence.days.${day.label}`)}
								</Label>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div class="space-y-2">
				<span id="end-options-label" class="block mb-2">
					{$t('task.recurrence.end.label')}
				</span>
				<RadioGroup bind:value={currentFormState.endType} aria-labelledby="end-options-label">
					<div class="flex items-center space-x-2">
						<RadioGroupItem value="never" id="never" />
						<Label for="never">{$t('task.recurrence.end.never')}</Label>
					</div>

					<div class="flex items-center space-x-2">
						<RadioGroupItem value="after" id="after" />
						<Label for="after">{$t('task.recurrence.end.after')}</Label>
						<Input
							type="number"
							min="1"
							max="999"
							class="w-20"
							id="occurrences-input"
							bind:value={currentFormState.occurrences}
							disabled={currentFormState.endType !== 'after'}
							aria-label={$t('task.recurrence.end.occurrences')}
						/>
						<span>{$t('task.recurrence.end.occurrences')}</span>
					</div>

					<div class="flex items-center space-x-2">
						<RadioGroupItem value="on_date" id="on_date" />
						<Label for="on_date">{$t('task.recurrence.end.on_date')}</Label>
						<Popover>
							<PopoverTrigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="outline"
										disabled={currentFormState.endType !== 'on_date'}
										class={cn(
											'w-[200px] justify-start text-left font-normal',
											!currentFormState.endDate && 'text-muted-foreground'
										)}
									>
										<CalendarIcon class="mr-2 h-4 w-4" />
										{formatDate(currentFormState.endDate)}
									</Button>
								{/snippet}
							</PopoverTrigger>
							<PopoverContent class="w-auto p-0">
								<Calendar type="single" bind:value={currentFormState.endDate} initialFocus {locale} />
							</PopoverContent>
						</Popover>
					</div>
				</RadioGroup>
			</div>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={handleClose}>
				{$t('common.cancel')}
			</Button>
			<Button onclick={handleSave}>
				{$t('common.save')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
