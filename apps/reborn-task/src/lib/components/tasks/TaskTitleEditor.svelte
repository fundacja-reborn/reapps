<script lang="ts">
	import { createLogger } from '@reborn/utils';
	import { cn } from '@reborn/ui';

	const logger = createLogger('TaskTitleEditor');

	// Props
	let {
		value,
		disabled = false,
		isCompleted = false,
		placeholder = '',
		onValueChanged,
		class: className = ''
	} = $props<{
		value: string;
		disabled?: boolean;
		isCompleted?: boolean;
		placeholder?: string;
		onValueChanged?: (value: string) => void;
		class?: string;
	}>();

	// Debug isCompleted changes
	$effect(() => {
		logger.debug('TaskTitleEditor isCompleted changed:', { isCompleted });
	});

	// Debug reactive classes
	$effect(() => {
		logger.debug('TaskTitleEditor completedClasses:', { isCompleted, completedClasses });
	});

	// State
	let textarea = $state<HTMLTextAreaElement | null>(null);

	// Reactive classes for completed state
	let completedClasses = $derived(isCompleted ? 'text-muted-foreground line-through' : '');

	// Update textarea height to fit content
	function updateTextareaHeight(textareaElement: HTMLTextAreaElement | null) {
		if (!textareaElement) return;

		// Save current scroll position
		const scrollPos = window.scrollY;

		// Reset height and set new height based on scroll height
		textareaElement.style.height = 'auto';
		const scrollHeight = textareaElement.scrollHeight;
		textareaElement.style.height = scrollHeight + 'px';

		// Restore scroll position
		window.scrollTo(0, scrollPos);
	}

	function handleInput(e: Event) {
		const textareaElement = e.target as HTMLTextAreaElement;
		updateTextareaHeight(textareaElement);

		// Only dispatch if value changed
		if (textareaElement.value !== value) {
			logger.debug('Title changed, dispatching valueChanged event');
			onValueChanged?.(textareaElement.value);
		}
	}

	function handleFocus(e: FocusEvent) {
		// Prevent scroll jumping on focus
		e.preventDefault();

		// Prevent scroll restoration
		if (e.target instanceof HTMLElement) {
			e.target.style.scrollMarginTop = '0';
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		// Prevent new line in title
		if (event.key === 'Enter') {
			event.preventDefault();

			// Blur to save changes
			if (textarea) {
				textarea.blur();
			}
		}
	}

	// Initialize height after mount
	$effect(() => {
		if (textarea && value) {
			// Wait for next tick for DOM to update
			setTimeout(() => {
				updateTextareaHeight(textarea);
			}, 0);
		}
	});
</script>

<div class="relative">
	<textarea
		bind:this={textarea}
		{value}
		oninput={handleInput}
		{placeholder}
		{disabled}
		class={cn(
			'w-full resize-none overflow-hidden border-none bg-transparent p-0',
			'placeholder:text-muted-foreground focus:outline-none focus:ring-0',
			'text-base font-medium',
			completedClasses,
			className
		)}
		rows="1"
		onfocus={handleFocus}
		onkeydown={handleKeyDown}
		aria-label="Task title"
	></textarea>
</div>
