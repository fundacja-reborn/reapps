<script lang="ts">
	import { 
		Button, 
		cn, 
		Label, 
		Popover, 
		PopoverContent, 
		PopoverTrigger, 
		Calendar, 
		Checkbox,
		IsMobile,
		TimeFieldInput,
		MobileTimePicker
	} from '@reborn/ui';
	import { CalendarIcon, Clock, X } from '@lucide/svelte';
	import { createLogger } from '@reborn/utils';
	import { t } from '$lib/stores/i18n.store';
	import { timeFormat, currentLanguage } from '$lib/stores/app-settings.store';
	import { 
		type DateValue, 
		DateFormatter, 
		getLocalTimeZone,
		parseDate,
		CalendarDate,
		Time
	} from '@internationalized/date';

	const logger = createLogger('DateTimePicker');

	// Props
	let {
		value = $bindable<string | undefined>(),
		hasTime = $bindable(false),
		minDate,
		maxDate,
		disabled = false,
		placeholder,
		class: className = '',
		variant = 'default',
		onChange,
		onConfirm
	} = $props<{
		value?: string;
		hasTime?: boolean;
		minDate?: string;
		maxDate?: string;
		disabled?: boolean;
		placeholder?: string;
		class?: string;
		variant?: 'default' | 'ghost';
		onChange?: (value: string | null, hasTime: boolean) => void;
		onConfirm?: () => void;
	}>();

	// State
	const isMobile = new IsMobile();
	let popoverOpen = $state(false);
	let isConfirming = $state(false);
	let timeValue = $state<Time>(new Time(0, 0));
	let calendarValue = $state<DateValue | undefined>();
	let showTimeCheckbox = $state(false);
	
	// Temporary values for popover / native pickers
	let tempCalendarValue = $state<DateValue | undefined>();
	let tempTimeValue = $state<Time>(new Time(0, 0));
	let tempShowTimeCheckbox = $state(false);
	
	// Mobile native input refs
	let dateInputRef = $state<HTMLInputElement>();
	
	// Mobile: Custom time picker drawer state
	let mobileTimePickerOpen = $state(false);
	
	// Derived hourCycle from user settings
	let hourCycle = $derived(($timeFormat === '12h' ? 12 : 24) as 12 | 24);
	let locale = $derived($currentLanguage === 'pl' ? 'pl' : 'en');
	
	// Prevent parent blur when interacting with popover
	let containerRef = $state<HTMLDivElement>();
	
	// Date formatter based on user's locale
	const dateFormatter = new DateFormatter('pl-PL', {
		dateStyle: 'medium'
	});
	
	const dateTimeFormatter = new DateFormatter('pl-PL', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	// Track previous value to avoid reactive loops
	let previousValue = $state<string | undefined>();

	// Parse value when it changes (from outside)
	$effect(() => {
		if (value === previousValue) return;
		previousValue = value;
		
		if (value) {
			try {
				const date = new Date(value);
				calendarValue = new CalendarDate(
					date.getFullYear(),
					date.getMonth() + 1,
					date.getDate()
				);
				if (hasTime) {
					timeValue = new Time(date.getHours(), date.getMinutes());
				} else {
					timeValue = new Time(0, 0);
				}
				showTimeCheckbox = hasTime;
			} catch (e: unknown) {
				logger.error('Failed to parse date:', value, e);
				calendarValue = undefined;
				timeValue = new Time(0, 0);
				showTimeCheckbox = false;
			}
		} else {
			calendarValue = undefined;
			timeValue = new Time(0, 0);
			showTimeCheckbox = false;
		}
	});

	// Copy main → temp when popover opens (desktop)
	$effect(() => {
		if (popoverOpen) {
			tempCalendarValue = calendarValue;
			// Default to 9:30 when no time is set yet
			tempTimeValue = hasTime
				? new Time(timeValue.hour, timeValue.minute)
				: new Time(9, 30);
			tempShowTimeCheckbox = showTimeCheckbox;
		}
	});

	// Update value when calendar or time changes
	function updateValue() {
		if (!calendarValue) {
			const newValue = undefined;
			value = newValue;
			previousValue = newValue;
			onChange?.(null, hasTime);
			return;
		}

		try {
			const jsDate = calendarValue.toDate(getLocalTimeZone());
			let newValue: string;
			
			if (hasTime && timeValue) {
				jsDate.setHours(timeValue.hour, timeValue.minute, 0, 0);
				newValue = jsDate.toISOString();
			} else {
				const utcDate = new Date(Date.UTC(
					jsDate.getFullYear(),
					jsDate.getMonth(),
					jsDate.getDate(),
					0, 0, 0, 0
				));
				newValue = utcDate.toISOString();
			}

			value = newValue;
			previousValue = newValue;
			onChange?.(newValue, hasTime);
		} catch (e: unknown) {
			logger.error('Failed to create date:', e);
		}
	}

	// Handle calendar change — always writes to temp state
	function handleCalendarChange(newValue: DateValue | undefined) {
		tempCalendarValue = newValue;
	}

	// Handle time change from TimeFieldInput — always writes to temp state
	function handleTimeChange(newTime: Time | undefined) {
		if (!newTime) return;
		// Skip if time hasn't actually changed
		if (tempTimeValue.hour === newTime.hour && tempTimeValue.minute === newTime.minute) return;
		tempTimeValue = newTime;
	}

	// Handle time checkbox change — always writes to temp state
	function handleTimeCheckboxChange(checked: boolean) {
		tempShowTimeCheckbox = checked;
	}

	// Clear selection — immediate (destructive action)
	function clearSelection() {
		calendarValue = undefined;
		timeValue = new Time(0, 0);
		hasTime = false;
		showTimeCheckbox = false;
		value = undefined;
		previousValue = undefined;
		onChange?.(null, false);
		popoverOpen = false;
	}

	// Get display text
	function getDisplayText(): string {
		if (!calendarValue) {
			return placeholder || $t('task.fields.select_date');
		}
		
		try {
			const jsDate = calendarValue.toDate(getLocalTimeZone());
			
			if (hasTime && timeValue) {
				jsDate.setHours(timeValue.hour, timeValue.minute);
				return dateTimeFormatter.format(jsDate);
			}
			
			return dateFormatter.format(jsDate);
		} catch {
			return calendarValue.toString();
		}
	}

	// Convert min/max dates to DateValue
	let minDateValue = $derived(minDate ? parseDate(minDate) : undefined);
	let maxDateValue = $derived(maxDate ? parseDate(maxDate) : undefined);
	
	// Handle focus/blur for inline editing compatibility
	function handleContainerBlur(e: FocusEvent) {
		const relatedTarget = e.relatedTarget as HTMLElement;
		if (containerRef && containerRef.contains(relatedTarget)) {
			e.stopPropagation();
			e.preventDefault();
		}
	}
	
	function handleContainerFocus(e: FocusEvent) {
		e.stopPropagation();
	}
	
	// Handle trigger click — mobile opens native date picker, desktop toggles popover
	function handleTriggerClick() {
		if (isMobile.matches) {
			dateInputRef?.showPicker();
		} else {
			popoverOpen = !popoverOpen;
		}
	}
	
	// Desktop: Popover confirm — commit temp → main + save
	function handlePopoverConfirm() {
		isConfirming = true;
		calendarValue = tempCalendarValue;
		timeValue = new Time(tempTimeValue.hour, tempTimeValue.minute);
		hasTime = tempShowTimeCheckbox;
		showTimeCheckbox = tempShowTimeCheckbox;
		updateValue();
		popoverOpen = false;
		onConfirm?.();
		// Reset flag after popover close is processed
		requestAnimationFrame(() => { isConfirming = false; });
	}
	
	// Desktop: Popover cancel — revert temp, close
	function handlePopoverCancel() {
		tempCalendarValue = calendarValue;
		tempTimeValue = new Time(timeValue.hour, timeValue.minute);
		tempShowTimeCheckbox = showTimeCheckbox;
		popoverOpen = false;
	}
	
	// Desktop: Popover open change — click-outside / Escape = cancel
	function handlePopoverOpenChange(open: boolean) {
		if (!open && !isConfirming) {
			// Closing without confirming = cancel
			tempCalendarValue = calendarValue;
			tempTimeValue = new Time(timeValue.hour, timeValue.minute);
			tempShowTimeCheckbox = showTimeCheckbox;
		}
		popoverOpen = open;
	}
	
	// Mobile: Native date input change
	function handleNativeDateChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = input.value; // YYYY-MM-DD
		if (!val) return;
		
		const [year, month, day] = val.split('-').map(Number);
		calendarValue = new CalendarDate(year, month, day);
		updateValue();
	}
	
	// Mobile: Format current date for native input value
	function getNativeDateValue(): string {
		if (!calendarValue) return '';
		const y = String(calendarValue.year).padStart(4, '0');
		const m = String(calendarValue.month).padStart(2, '0');
		const d = String(calendarValue.day).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}
	
	// Mobile: Open custom time picker drawer
	// Replaces native <input type="time"> showPicker() which has a Chromium bug:
	// Chrome Android 147+ always shows "Clear" button regardless of `required` attribute,
	// causing button row overflow on narrow screens. No HTML/CSS/JS workaround exists.
	// Tested 2026-04-16: required, value, min/max, step — none hide the Clear button.
	function handleMobileTimeTrigger(e: Event) {
		e.stopPropagation();
		mobileTimePickerOpen = true;
	}
	
	// Mobile: Custom time picker confirm callback
	function handleMobileTimeConfirm(h: number, m: number) {
		timeValue = new Time(h, m);
		hasTime = true;
		showTimeCheckbox = true;
		updateValue();
	}
</script>

<div 
	bind:this={containerRef}
	class="date-time-picker-container"
	data-date-time-picker="true"
	onblur={handleContainerBlur}
	onfocus={handleContainerFocus}
>
	<!-- Mobile: Native pickers -->
	{#if isMobile.matches}
		<button
			type="button"
			onclick={handleTriggerClick}
			class={cn(
				"flex items-center text-sm ring-offset-background",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
				"disabled:cursor-not-allowed disabled:opacity-50",
				variant === 'default' && [
					"h-10 w-full justify-between rounded-md border border-input bg-background px-3 py-2",
					"hover:bg-accent hover:text-accent-foreground",
					"placeholder:text-muted-foreground"
				],
				variant === 'ghost' && [
					"gap-2 hover:bg-muted rounded px-2 py-1 transition-colors"
				],
				!calendarValue && "text-muted-foreground",
				className
			)}
			{disabled}
			aria-label={$t('task.fields.select_date')}
		>
			<span class="flex items-center gap-2">
				<CalendarIcon class="h-4 w-4" />
				{getDisplayText()}
			</span>
			<span class="ml-auto flex items-center gap-1">
				{#if value && !disabled}
					<span
						onclick={handleMobileTimeTrigger}
						class="flex items-center justify-center min-w-[44px] min-h-[44px] -my-2 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
						aria-label={$t('task.fields.add_time')}
						role="button"
						tabindex="0"
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								handleMobileTimeTrigger(e);
							}
						}}
					>
						<Clock class="h-5 w-5" />
					</span>
				{/if}
				{#if value && !disabled && variant === 'default'}
					<span
						onclick={(e) => {
							e.stopPropagation();
							clearSelection();
						}}
						class="flex items-center justify-center min-w-[44px] min-h-[44px] -my-2 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
						aria-label={$t('task.fields.clear_date')}
						role="button"
						tabindex="0"
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								e.stopPropagation();
								clearSelection();
							}
						}}
					>
						<X class="h-5 w-5" />
					</span>
				{/if}
			</span>
		</button>
		
		<!-- Hidden native inputs for mobile -->
		<input
			bind:this={dateInputRef}
			type="date"
			required
			class="fixed top-1/2 left-1/2 opacity-0 w-px h-px pointer-events-none"
			value={getNativeDateValue()}
			min={minDate}
			max={maxDate}
			onchange={handleNativeDateChange}
			tabindex="-1"
			aria-hidden="true"
		/>
		<!-- Mobile: Custom time picker drawer (replaces native <input type="time"> due to Chromium Clear button overflow bug) -->
		<MobileTimePicker
			bind:open={mobileTimePickerOpen}
			hour={hasTime ? timeValue.hour : 9}
			minute={hasTime ? timeValue.minute : 30}
			title={$t('task.fields.set_time') || 'Set time'}
			cancelLabel={$t('common.cancel') || 'Cancel'}
			confirmLabel={$t('common.save') || 'Save'}
			onConfirm={handleMobileTimeConfirm}
		/>
	
	<!-- Desktop: Popover with deferred save -->
	{:else}
		<Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
			<PopoverTrigger
				class={cn(
					"flex items-center text-sm ring-offset-background",
					"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
					"disabled:cursor-not-allowed disabled:opacity-50",
					variant === 'default' && [
						"h-10 w-full justify-between rounded-md border border-input bg-background px-3 py-2",
						"hover:bg-accent hover:text-accent-foreground",
						"placeholder:text-muted-foreground"
					],
					variant === 'ghost' && [
						"gap-2 hover:bg-muted rounded px-2 py-1 transition-colors"
					],
					!calendarValue && "text-muted-foreground",
					className
				)}
				{disabled}
				aria-label={$t('task.fields.select_date')}
			>
				<span class="flex items-center gap-2">
					<CalendarIcon class="h-4 w-4" />
					{getDisplayText()}
				</span>
				{#if value && !disabled && variant === 'default'}
					<span
						onclick={(e) => {
							e.stopPropagation();
							clearSelection();
						}}
						class="ml-auto rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer p-0.5"
						aria-label={$t('task.fields.clear_date')}
						role="button"
						tabindex="0"
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								e.stopPropagation();
								clearSelection();
							}
						}}
					>
						<X class="h-4 w-4" />
					</span>
				{/if}
			</PopoverTrigger>
			
			<PopoverContent 
				class="w-auto p-0" 
				align="start"
				trapFocus={false}
			>
				<div class="p-3">
					<Calendar 
						type="single" 
						bind:value={tempCalendarValue}
						onValueChange={handleCalendarChange}
						minValue={minDateValue}
						maxValue={maxDateValue}
						{locale}
					/>
					
					{#if tempCalendarValue}
						<div class="border-t mt-3 pt-3 space-y-3">
							<!-- Time checkbox -->
							<div class="flex items-center space-x-2">
								<Checkbox
									id="time-checkbox"
									checked={tempShowTimeCheckbox}
									onCheckedChange={handleTimeCheckboxChange}
								/>
								<Label 
									for="time-checkbox" 
									class="text-sm font-medium cursor-pointer flex items-center gap-2"
								>
									<Clock class="h-4 w-4" />
									{$t('task.fields.add_time')}
								</Label>
							</div>
							
							<!-- Time input -->
							{#if tempShowTimeCheckbox}
								<div class="space-y-2">
									<TimeFieldInput
										value={tempTimeValue}
										onValueChange={handleTimeChange}
										{hourCycle}
										{locale}
									/>
								</div>
							{/if}
						</div>
					{/if}
				</div>
				
				<!-- Confirm / Cancel buttons -->
				<div class="border-t px-3 py-2 flex gap-2 justify-end">
					<Button variant="outline" size="sm" onclick={handlePopoverCancel}>
						{$t('common.cancel') || 'Anuluj'}
					</Button>
					<Button size="sm" onclick={handlePopoverConfirm}>
						{$t('common.save') || 'Zapisz'}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	{/if}
</div>

<style>
	.date-time-picker-container {
		position: relative;
	}
</style>
